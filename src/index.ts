import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import crypto from 'crypto';
import { DatabaseService } from './services/database.service';
import { TelegramProvider } from './providers/telegram.provider';
import { GeminiService } from './services/gemini.service';
import { TelegramSourceService } from './services/telegram-source.service';

const app = express();
const databaseService = new DatabaseService();
const telegramProvider = new TelegramProvider();
const geminiService = new GeminiService();
const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('🤖 Promoliza Bot está rodando com sucesso!');
});

app.listen(PORT, () => {
  console.log(`🌐 [HTTP] Servidor Web ativo na porta ${PORT}`);
});

async function handleDealLink(affiliateUrl: string, sourceText: string, image?: Buffer): Promise<void> {
  const productId = `ml_link_${crypto.createHash('sha256').update(affiliateUrl).digest('hex').slice(0, 32)}`;
  if (databaseService.isProductPosted(productId)) {
    console.log(`[Promoliza] Oferta ignorada: link já enviado nos últimos 30 dias.`);
    return;
  }

  const caption = await geminiService.generateCaption(sourceText);
  await telegramProvider.sendConvertedMessage(caption, affiliateUrl, image);
  databaseService.savePostedProduct(productId);
  console.log(`✅ [Promoliza] Oferta convertida e enviada: ${affiliateUrl}`);
}

async function start(): Promise<void> {
  const source = new TelegramSourceService(handleDealLink);
  await source.start();
}

start().catch((error: unknown) => {
  console.error('❌ [Promoliza] Não foi possível iniciar a leitura do Telegram:', error);
  process.exitCode = 1;
});
