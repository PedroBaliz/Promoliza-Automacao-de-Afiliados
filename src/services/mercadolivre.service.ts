import axios from 'axios';
import { Product } from '../types';

export class MercadoLivreService {
  private readonly baseUrl = 'https://api.mercadolivre.com/sites/MLB/search';

  /**
   * Busca ofertas por palavra-chave e aplica filtros de desconto e frete
   */
  async fetchDeals(keyword: string, minDiscountPercentage = 20): Promise<Product[]> {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          q: keyword,
          limit: 20,
        },
      });

      const results = response.data.results || [];
      const filteredProducts: Product[] = [];

      for (const item of results) {
        const originalPrice = item.original_price || item.price;
        const currentPrice = item.price;

        // Calcula a percentagem real de desconto
        if (originalPrice > currentPrice) {
          const discount = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);

          if (discount >= minDiscountPercentage) {
            filteredProducts.push({
              id: item.id,
              title: item.title,
              originalPrice,
              promotionalPrice: currentPrice,
              discountPercentage: discount,
              permalink: item.permalink,
              thumbnail: item.thumbnail,
              freeShipping: item.shipping?.free_shipping || false,
            });
          }
        }
      }

      return filteredProducts;
    } catch (error) {
      console.error('Erro ao buscar produtos na API do Mercado Livre:', error);
      return [];
    }
  }
}