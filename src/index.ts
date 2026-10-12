import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import { AuthService } from './services/auth.service';
import { MercadoLivreService } from './services/mercadolivre.service';
import { AIService } from './services/ai.service';
import { DatabaseService } from './services/database.service';
import { TelegramProvider } from './providers/telegram.provider';
import { buildAffiliateUrl } from './utils/affiliate';

// Inicialização dos Serviços
const authService = new AuthService();
const mercadoLivreService = new MercadoLivreService(authService);
const aiService = new AIService();
const databaseService = new DatabaseService();
const telegramProvider = new TelegramProvider();

/**
 * Função principal de orquestração da busca e envio de ofertas
 */
async function runPromoliza() {
  console.log('\n🔍 [Promoliza] Iniciando busca por ofertas imperdíveis...');

  try {
    // 1. Busca ofertas no Mercado Livre
    const keywords = ['gaming', 'hardware', 'perifericos', 'smartphone'];
    const selectedKeyword = keywords[Math.floor(Math.random() * keywords.length)];

    const deals = await mercadoLivreService.fetchDeals(selectedKeyword, 15);

    if (!deals || deals.length === 0) {
      console.log('⚠️ [Promoliza] Nenhuma oferta qualificada encontrada neste ciclo.');
      return;
    }

    // 2. Filtra produtos que ainda não foram postados
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

    console.log(`✨ Oferta selecionada: ${targetProduct.title}`);

    // 3. Monta o link com a Tag de Afiliado
    const affiliateUrl = buildAffiliateUrl(targetProduct.permalink);

    // 4. Gera a legenda persuasiva via Gemini com os campos exatos do tipo Product
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

    // 5. Envia para o Telegram com os parâmetros esperados pelo provider
    await telegramProvider.sendDealMessage(
      caption,
      targetProduct.thumbnail,
      affiliateUrl
    );

    // 6. Registra no banco/memória para evitar postagens duplicadas
    await databaseService.savePostedProduct(targetProduct.id);

    console.log('🚀 [Promoliza] Oferta publicada com sucesso no Telegram!\n');
  } catch (error: any) {
    console.error('❌ [Promoliza] Erro durante a execução do ciclo:', error?.message || error);
  }
}

// Execução imediata na inicialização para teste
runPromoliza();

// Agendamento via CRON (a cada 30 minutos)
cron.schedule('*/30 * * * *', () => {
  runPromoliza();
});

console.log('🤖 [Promoliza] Bot iniciado e aguardando próximos ciclos de agendamento...');