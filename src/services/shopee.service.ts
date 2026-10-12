import { Product } from '../types';

export class ShopeeService {
  async fetchDeals(_minDiscountPercentage = 10): Promise<Product[]> {
    console.error('[Shopee] Integração desativada até configurar uma fonte de dados autorizada.');
    return [];
  }
}
