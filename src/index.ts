import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import crypto from 'crypto';
import { DatabaseService } from './services/database.service';
import { TelegramProvider } from './providers/telegram.provider';
import { TelegramSourceService } from './services/telegram-source.service';
import { WhatsAppProvider } from './providers/whatsapp.provider';

const app = express();
const databaseService = new DatabaseService();
const telegramProvider = new TelegramProvider();
const whatsappProvider = new WhatsAppProvider();
const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('🤖 Promoliza Bot está rodando com sucesso!');
});

app.listen(PORT, () => {
  console.log(`🌐 [HTTP] Servidor Web ativo na porta ${PORT}`);
});

async function handleDealLink(affiliateUrl: string, sourceCaption: string, image?: Buffer): Promise<void> {
  const productId = `ml_link_${crypto.createHash('sha256').update(affiliateUrl).digest('hex').slice(0, 32)}`;
  if (databaseService.isProductPosted(productId)) {
    console.log(`[Promoliza] Oferta ignorada: link já enviado nos últimos 30 dias.`);
    return;
  }

  const caption = `${sourceCaption}\n\n🛒 Acessar oferta: ${affiliateUrl}`;

  // Telegram é o canal principal: se falhar, o erro sobe e a mensagem é tentada de novo no próximo ciclo.
  await telegramProvider.sendConvertedMessage(sourceCaption, affiliateUrl, image);

  // WhatsApp é opcional: uma falha aqui nunca bloqueia nem duplica a publicação no Telegram.
  try {
    await whatsappProvider.sendMessage(caption, image);
  } catch (error: unknown) {
    console.error('❌ [WhatsApp] Falha ao enviar oferta:', error);
  }

  databaseService.savePostedProduct(productId);
  console.log(`✅ [Promoliza] Oferta convertida e enviada: ${affiliateUrl}`);
}

async function start(): Promise<void> {
  if (process.env.WHATSAPP_GROUP_JID) {
    await whatsappProvider.start();
  } else {
    console.log('[WhatsApp] WHATSAPP_GROUP_JID não configurado; publicação no WhatsApp desabilitada.');
  }

  const source = new TelegramSourceService(handleDealLink);
  await source.start();
}

start().catch((error: unknown) => {
  console.error('❌ [Promoliza] Não foi possível iniciar a leitura do Telegram:', error);
  process.exitCode = 1;
});
