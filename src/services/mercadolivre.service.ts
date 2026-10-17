import axios from 'axios';
import { Product } from '../types';

export class MercadoLivreService {
  private readonly baseUrl = 'https://api.mercadolibre.com/sites/MLB/search';

  async fetchDeals(keyword: string = 'promocao', minDiscountPercentage = 5): Promise<Product[]> {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          q: keyword,
          limit: 30,
        },
        headers: {
          // Remover User-Agent de navegador previne o bloqueio 403 da API pública
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip,deflate,compress',
        },
        timeout: 10000,
      });

      const results = response.data?.results || [];
      const products: Product[] = [];

      for (const item of results) {
        if (!item.id || !item.title || !item.price) continue;

        const originalPrice = item.original_price || (item.price * 1.15);
        const currentPrice = item.price;

        let discount = 0;
        if (originalPrice > currentPrice) {
          discount = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
        }

        if (discount >= minDiscountPercentage || item.original_price) {
          // Melhora a resolução da imagem enviada pelo ML
          const highResThumbnail = item.thumbnail
            ? item.thumbnail.replace('http://', 'https://').replace('-I.jpg', '-O.jpg')
            : '';

          products.push({
            id: `ml_${item.id}`,
            title: item.title,
            originalPrice: Number(originalPrice.toFixed(2)),
            promotionalPrice: Number(currentPrice.toFixed(2)),
            discountPercentage: discount > 0 ? discount : 10,
            permalink: item.permalink,
            thumbnail: highResThumbnail,
            freeShipping: item.shipping?.free_shipping || false,
          });
        }
      }

      return products;
    } catch (error: any) {
      console.error('❌ [MercadoLivre] Erro ao buscar produtos:', error?.response?.status || error?.message || error);
      return [];
    }
  }
}