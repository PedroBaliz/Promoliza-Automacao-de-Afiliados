import axios from 'axios';
import { Product } from '../types';

export class ShopeeService {
  // Endpoint público de recomendações da Shopee (não dispara o anti-bot 90309999)
  private readonly baseUrl = 'https://shopee.com.br/api/v4/recommend/recommend';

  async fetchDeals(minDiscountPercentage = 10): Promise<Product[]> {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          bundle: 'daily_discover_main',
          item_card: 2,
          limit: 30,
          offset: 0,
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'Referer': 'https://shopee.com.br/',
          'x-api-source': 'pc',
          'x-shopee-language': 'pt',
        },
        timeout: 10000,
      });

      const sections = response.data?.data?.sections || [];
      let rawItems: any[] = [];

      for (const section of sections) {
        if (section.data?.item) {
          rawItems = rawItems.concat(section.data.item);
        }
      }

      const products: Product[] = [];

      for (const item of rawItems) {
        if (!item || !item.price) continue;

        // Na Shopee os preços vêm multiplicados por 100.000
        const rawOriginal = item.price_before_discount || item.price_max_before_discount || item.price;
        const rawCurrent = item.price;

        const originalPrice = rawOriginal > 1000 ? rawOriginal / 100000 : rawOriginal;
        const currentPrice = rawCurrent > 1000 ? rawCurrent / 100000 : rawCurrent;

        let discount = item.discount ? parseInt(item.discount.replace('%', ''), 10) : 0;
        if (!discount && originalPrice > currentPrice) {
          discount = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
        }

        if (discount >= minDiscountPercentage || originalPrice > currentPrice) {
          const cleanTitle = item.name ? item.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() : 'produto';
          const permalink = `https://shopee.com.br/${cleanTitle}-i.${item.shopid}.${item.itemid}`;
          const thumbnail = item.image ? `https://down-br.img.susercontent.com/file/${item.image}` : '';

          products.push({
            id: `shopee_${item.itemid}`,
            title: item.name,
            originalPrice: Number(originalPrice.toFixed(2)),
            promotionalPrice: Number(currentPrice.toFixed(2)),
            discountPercentage: discount > 0 ? discount : 15,
            permalink,
            thumbnail,
            freeShipping: item.show_free_shipping || false,
          });
        }
      }

      return products;
    } catch (error: any) {
      if (error?.response) {
        console.error('[Shopee] Falha na requisição', {
          status: error.response.status,
          url: error.config?.url,
          method: error.config?.method,
          data: error.response.data,
        });
      } else {
        console.error('[Shopee] Erro de conexão:', error?.message || error);
      }

      return [];
    }
  }
}
