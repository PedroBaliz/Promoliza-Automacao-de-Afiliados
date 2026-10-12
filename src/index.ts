import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import { ShopeeService } from './services/shopee.service';
import { AIService } from './services/ai.service';
import { DatabaseService } from './services/database.service';
import { TelegramProvider } from './providers/telegram.provider';
import { buildAffiliateUrl } from './utils/affiliate';
import { config } from './config/env.config';
import { Product } from './types';

const shopeeService = new ShopeeService();
const aiService = new AIService();
const databaseService = new DatabaseService();
const telegramProvider = new TelegramProvider();

let cycleRunning = false;

async function runPromoliza(): Promise<void> {
  if (cycleRunning) {
    console.warn('[Promoliza] Ciclo anterior ainda em execução; ignorando este disparo.');
    return;
  }

  cycleRunning = true;
  try {
    console.log('\n[Promoliza] Buscando ofertas na Shopee...');
    const deals = await shopeeService.fetchDeals(config.minDiscountPercentage);
    const candidates: Product[] = deals
      .filter((deal) =>
        Boolean(deal.id && deal.title && deal.permalink)
        && Number.isFinite(deal.promotionalPrice)
        && deal.promotionalPrice > 0
        && Number.isFinite(deal.discountPercentage)
        && deal.discountPercentage >= config.minDiscountPercentage
        && deal.originalPrice >= deal.promotionalPrice,
      )
      .sort((a, b) => b.discountPercentage - a.discountPercentage);

    console.log(`[Promoliza] Ofertas qualificadas: ${candidates.length}`);
    const targetProduct = candidates.find((deal) => !databaseService.isProductPosted(deal.id));

    if (!targetProduct) {
      console.log('[Promoliza] Nenhuma oferta nova e válida neste ciclo.');
      return;
    }

    const affiliateUrl = buildAffiliateUrl(targetProduct.permalink);
    const caption = await aiService.generateCaption({ ...targetProduct, permalink: affiliateUrl });
    await telegramProvider.sendOffer({ product: targetProduct, caption, affiliateUrl });
    databaseService.savePostedProduct(targetProduct.id);
    console.log(`[Promoliza] Oferta publicada: ${targetProduct.title}`);
  } catch (error: unknown) {
    console.error('[Promoliza] Falha no ciclo:', error instanceof Error ? error.message : error);
  } finally {
    cycleRunning = false;
  }
}

void runPromoliza();
cron.schedule('*/30 * * * *', () => {
  void runPromoliza();
});
console.log('[Promoliza] Bot iniciado; agendamento a cada 30 minutos.');
