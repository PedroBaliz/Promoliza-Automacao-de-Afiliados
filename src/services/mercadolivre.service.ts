import axios from 'axios';
import { Product } from '../types';
import { AuthService } from './auth.service';

export class MercadoLivreService {
  private readonly baseUrl = 'https://api.mercadolibre.com/sites/MLB/search';

  constructor(private authService: AuthService) {}

  async fetchDeals(keyword: string, minDiscountPercentage = 10): Promise<Product[]> {
    try {
      const token = await this.authService.getValidToken();

      // Mapeamento de categorias populares no Brasil (MLB)
      // MLB1051 = Informática / PC Gamer | MLB1000 = Eletrônicos | MLB1055 = Celulares
      const response = await axios.get(this.baseUrl, {
        params: {
          category: 'MLB1051', // Busca focada na categoria de Informática/Gaming
          limit: 30,
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'User-Agent': 'PromolizaBot/1.0',
        },
      });

      const results = response.data.results || [];
      const filteredProducts: Product[] = [];

      for (const item of results) {
        const originalPrice = item.original_price || item.price;
        const currentPrice = item.price;

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
    } catch (error: any) {
      console.error('Erro ao buscar produtos na API do Mercado Livre:', error?.response?.data || error?.message || error);
      return [];
    }
  }
}