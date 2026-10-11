import dotenv from 'dotenv';
import cron from 'node-cron';
import { MercadoLivreService } from './services/mercadolivre.service';
import { AIService } from './services/ai.service';
import { DatabaseService } from './services/database.service';
import { TelegramProvider } from './providers/telegram.provider';
import { buildAffiliateUrl } from './utils/affiliate';

// Carrega as variáveis de ambiente do .env
dotenv.config();

const mlService = new MercadoLivreService();
const aiService = new AIService();
const dbService = new DatabaseService();
const telegramProvider = new TelegramProvider();

async function runPromoliza() {
  console.log('🔍 [Promoliza] Iniciando busca por ofertas imperdíveis...');

  try {
    // Busca produtos em promoção
    const products = await mlService.fetchDeals('gaming', 20);

    if (products.length === 0) {
      console.log('⚠️ [Promoliza] Nenhuma oferta encontrada neste ciclo.');
      return;
    }

    for (const product of products) {
      // Verifica se o produto já foi postado
      if (dbService.hasBeenSent(product.id)) {
        continue;
      }

      console.log(`✨ Oferta encontrada: ${product.title}`);

      // Gera a legenda persuasiva com a Gemini API
      const caption = await aiService.generateCaption(product);

      // Converte a URL para link de afiliado
      const affiliateUrl = buildAffiliateUrl(product.permalink);

      // Dispara para o canal do Telegram
      await telegramProvider.sendOffer({
        product,
        caption,
        affiliateUrl,
      });

      // Marca o produto como enviado
      dbService.markAsSent(product.id);
      console.log(`🚀 Oferta disparada com sucesso no Telegram! ID: ${product.id}`);

      // Processa uma oferta por ciclo para evitar spam
      break;
    }
  } catch (error) {
    console.error('❌ [Promoliza] Erro durante a execução do robô:', error);
  }
}

// Executa o robô a cada 15 minutos via Cron Job
cron.schedule('*/15 * * * *', () => {
  runPromoliza();
});

// Executa uma vez imediatamente ao iniciar a aplicação
runPromoliza();