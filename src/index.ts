import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cron from 'node-cron';
import { MercadoLivreService } from './services/mercadolivre.service';
import { AIService } from './services/ai.service';
import { DatabaseService } from './services/database.service';
import { TelegramProvider } from './providers/telegram.provider';
import { buildAffiliateUrl } from './utils/affiliate';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 Promoliza Bot está rodando com sucesso!');
});

app.listen(PORT, () => {
  console.log(`🌐 [HTTP] Servidor Web ativo na porta ${PORT}`);
});

const mercadoLivreService = new MercadoLivreService();
const aiService = new AIService();
const databaseService = new DatabaseService();
const telegramProvider = new TelegramProvider();

async function runPromoliza() {
  console.log('\n🔍 [Promoliza] Buscando ofertas no Mercado Livre...');

  try {
    const deals = await mercadoLivreService.fetchDeals('promocao gamer', 10);
    console.log(`📊 Ofertas encontradas no Mercado Livre: ${deals.length}`);

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
      console.log('ℹ️ [Promoliza] Todas as ofertas encontradas já foram publicadas recentemente.');
      return;
    }

    console.log(`✨ Oferta selecionada do Mercado Livre: ${targetProduct.title}`);

    const affiliateUrl = buildAffiliateUrl(targetProduct.permalink);

    console.log('🤖 Gerando legenda persuasiva com Gemini AI...');
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
    await telegramProvider.sendDealMessage(
      caption,
      targetProduct.thumbnail,
      affiliateUrl
    );

    await databaseService.savePostedProduct(targetProduct.id);
    console.log('✅ [Promoliza] Oferta do Mercado Livre enviada e registrada com sucesso!\n');
  } catch (error: any) {
    console.error('❌ [Promoliza] Erro no ciclo:', error?.message || error);
  }
}

// Execução inicial ao subir
runPromoliza();

// Cron Job a cada 30 minutos
cron.schedule('*/30 * * * *', () => {
  runPromoliza();
});