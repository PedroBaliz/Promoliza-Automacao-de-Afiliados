import axios from 'axios';
import { Product } from '../types';

export class DealsFeedService {
  private readonly apiUrl = 'https://gatry.com/promocoes/json';

  async fetchTopDeals(minDiscountPercentage = 10): Promise<Product[]> {
    try {
      const response = await axios.get(this.apiUrl, { timeout: 10000 });
      const items = Array.isArray(response.data) ? response.data : response.data?.promocoes;
      if (!Array.isArray(items)) return [];

      const products: Product[] = [];
      for (const item of items) {
        const title = typeof item?.titulo === 'string' ? item.titulo.trim() : '';
        const link = typeof item?.link === 'string' ? item.link : item?.url;
        const price = Number.parseFloat(String(item?.preco ?? '').replace(/[^\d,.]/g, '').replace(',', '.'));
        const originalPrice = Number(item?.preco_original ?? item?.preco_de ?? item?.original_price);
        if (!title || typeof link !== 'string' || !Number.isFinite(price) || price <= 0) continue;
        if (!Number.isFinite(originalPrice) || originalPrice <= price) continue;

        const discountPercentage = Math.round(((originalPrice - price) / originalPrice) * 100);
        if (discountPercentage < minDiscountPercentage) continue;

        let permalink: URL;
        try { permalink = new URL(link, this.apiUrl); } catch { continue; }
        if (!['http:', 'https:'].includes(permalink.protocol)) continue;

        products.push({
          id: `gatry_${String(item?.id || permalink.toString())}`,
          title,
          originalPrice,
          promotionalPrice: price,
          discountPercentage,
          permalink: permalink.toString(),
          thumbnail: typeof item?.imagem === 'string' ? item.imagem : typeof item?.foto === 'string' ? item.foto : '',
          freeShipping: item?.frete_gratis === true || item?.free_shipping === true,
        });
      }
      return products;
    } catch (error: unknown) {
      console.error('[DealsFeed] Falha ao buscar promoções:', axios.isAxiosError(error) ? error.message : String(error));
      return [];
    }
  }
}
