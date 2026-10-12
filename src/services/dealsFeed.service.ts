import axios from 'axios';
import { Product } from '../types';

export class DealsFeedService {
  private readonly apiUrl = 'https://gatry.com/promocoes/json';

  async fetchTopDeals(): Promise<Product[]> {
    try {
      const response = await axios.get(this.apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://gatry.com/',
        },
        timeout: 10000,
      });

      const items = Array.isArray(response.data) ? response.data : response.data?.promocoes || [];
      const products: Product[] = [];

      for (const item of items) {
        if (!item.titulo) continue;

        // Limpa e converte o valor da promoção
        const rawPrice = item.preco ? String(item.preco).replace(/[^\d,.]/g, '').replace(',', '.') : '0';
        const price = parseFloat(rawPrice) || 0;

        products.push({
          id: `gatry_${item.id || item.link}`,
          title: item.titulo,
          originalPrice: price > 0 ? Number((price * 1.25).toFixed(2)) : 0,
          promotionalPrice: price,
          discountPercentage: 20,
          permalink: item.link || item.url || 'https://gatry.com',
          thumbnail: item.imagem || item.foto || '',
          freeShipping: true,
        });
      }

      return products;
    } catch (error: any) {
      console.error('❌ [DealsFeed] Erro ao buscar JSON de promoções:', error?.message || error);
      return [];
    }
  }
}