import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cron from 'node-cron';
import { ShopeeService } from './services/shopee.service';
import { AIService } from './services/ai.service';
import { DatabaseService } from './services/database.service';
import { TelegramProvider } from './providers/telegram.provider';
import { buildAffiliateUrl } from './utils/affiliate';

// Inicializa o servidor web para satisfazer o Health Check da Vercel
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 Promoliza Bot está rodando com sucesso!');
});

app.listen(PORT, () => {
  console.log(`🌐 [HTTP] Servidor Web ativo escutando na porta ${PORT}`);
});

// Instâncias dos Serviços
const shopeeService = new ShopeeService();
const aiService = new AIService();
const databaseService = new DatabaseService();
const telegramProvider = new TelegramProvider();

async function runPromoliza() {
  console.log('\n🔍 [Promoliza] Buscando ofertas...');

  try {
    const deals = await shopeeService.fetchDeals(10);
    console.log(`📊 Ofertas encontradas: ${deals.length}`);

    if (!deals || deals.length === 0) {
      console.log('⚠️ [Promoliza] Nenhuma oferta encontrada neste ciclo.');
      return;
    }

    let targetProduct = null;
    for (const deal of deals) {
      const alreadyPosted = await databaseService.isProductPosted(deal.id);
      if (!alreadyPosted) {
        targetProduct = deal;
        break;
      }
    }

    if (!targetProduct) {
      console.log('ℹ️ [Promoliza] Todas as ofertas já foram publicadas recentemente.');
      return;
    }

    console.log(`✨ Oferta selecionada: ${targetProduct.title}`);

    const affiliateUrl = buildAffiliateUrl(targetProduct.permalink);

    console.log('🤖 Gerando legenda persuasiva via Gemini...');
    const caption = await aiService.generateCaption({
      id: targetProduct.id,
      title: targetProduct.title,
      originalPrice: targetProduct.originalPrice,
      promotionalPrice: targetProduct.promotionalPrice,
      discountPercentage: targetProduct.discountPercentage,
      permalink: affiliateUrl,
      thumbnail: targetProduct.thumbnail,
      freeShipping: targetProduct.freeShipping,
    });

    console.log('🚀 Disparando para o Telegram...');
    await telegramProvider.sendDealMessage(
      caption,
      targetProduct.thumbnail,
      affiliateUrl
    );

    await databaseService.savePostedProduct(targetProduct.id);
    console.log('✅ [Promoliza] Oferta enviada com sucesso!\n');
  } catch (error: any) {
    console.error('❌ [Promoliza] Erro durante o ciclo:', error?.message || error);
  }
}

// Execução inicial ao subir
runPromoliza();

// Agendamento no CRON (a cada 30 minutos)
cron.schedule('*/30 * * * *', () => {
  runPromoliza();
});