import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import { ShopeeService } from './services/shopee.service';
import { AIService } from './services/ai.service';
import { DatabaseService } from './services/database.service';
import { TelegramProvider } from './providers/telegram.provider';
import { buildAffiliateUrl } from './utils/affiliate';

const shopeeService = new ShopeeService();
const aiService = new AIService();
const databaseService = new DatabaseService();
const telegramProvider = new TelegramProvider();

async function runPromoliza() {
  console.log('\n🔍 [Promoliza] Buscando ofertas na Shopee...');

  try {
    const deals = await shopeeService.fetchDeals(10);
    console.log(`📊 Total de ofertas retornadas da Shopee: ${deals.length}`);

    if (!deals || deals.length === 0) {
      console.log('⚠️ [Promoliza] Nenhuma oferta qualificada encontrada neste ciclo.');
      return;
    }

    // Filtra duplicados
    let targetProduct = null;
    for (const deal of deals) {
      const alreadyPosted = await databaseService.isProductPosted(deal.id);
      if (!alreadyPosted) {
        targetProduct = deal;
        break;
      }
    }

    if (!targetProduct) {
      console.log('ℹ️ [Promoliza] Todas as ofertas encontradas já foram publicadas recentemente.');
      return;
    }

    console.log(`✨ Oferta selecionada da Shopee: ${targetProduct.title}`);

    const affiliateUrl = buildAffiliateUrl(targetProduct.permalink);

    console.log('🤖 Gerando legenda com Gemini AI...');
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

    console.log('🚀 Disparando mensagem no Telegram...');
    await telegramProvider.sendOffer({
      product: targetProduct,
      caption,
      affiliateUrl,
    });

    databaseService.savePostedProduct(targetProduct.id);
    console.log('✅ [Promoliza] Oferta da Shopee enviada com sucesso!\n');
  } catch (error: any) {
    console.error('❌ [Promoliza] Erro no ciclo:', error?.message || error);
  }
}

// Execução imediata
runPromoliza();

// Agendamento no CRON (a cada 30 minutos)
cron.schedule('*/30 * * * *', () => {
  runPromoliza();
});

console.log('🤖 [Promoliza] Bot ativo e monitorando a Shopee...');