import { GoogleGenAI } from '@google/genai';
import { Product } from '../types';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class AIService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (apiKey) this.ai = new GoogleGenAI({ apiKey });
  }

  async generateCaption(product: Product): Promise<string> {
    if (!this.ai) return this.getFallbackCaption(product);

    const prompt = `Crie uma legenda curta e verdadeira em português para uma oferta de e-commerce.
Use apenas os dados fornecidos. Não invente frete, preço ou características. Use HTML simples para Telegram (<b>, <s>) e não inclua links.
Produto: ${product.title}
Preço anterior confirmado: R$ ${product.originalPrice.toFixed(2)}
Preço atual: R$ ${product.promotionalPrice.toFixed(2)}
Desconto calculado: ${product.discountPercentage}%
Frete grátis confirmado: ${product.freeShipping ? 'sim' : 'não'}`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      const text = response.text?.trim();
      if (!text) return this.getFallbackCaption(product);
      return text
        .replace(/<(?!\/?(?:b|strong|i|em|s|strike|del)\b)[^>]*>/gi, '')
        .slice(0, 850);
    } catch (error) {
      console.error('[AI] Não foi possível gerar legenda com Gemini:', error);
      return this.getFallbackCaption(product);
    }
  }

  private getFallbackCaption(product: Product): string {
    const title = escapeHtml(product.title);
    const discountLine = product.discountPercentage > 0
      ? `\n🏷️ <b>${product.discountPercentage}% OFF</b>`
      : '';
    const originalLine = product.originalPrice > product.promotionalPrice
      ? `\nDe: <s>R$ ${product.originalPrice.toFixed(2)}</s>`
      : '';
    const shippingLine = product.freeShipping ? '\n🚚 <b>Frete grátis confirmado</b>' : '';

    return `🔥 <b>Oferta encontrada</b>\n\n📦 ${title}${originalLine}\n💰 <b>Por R$ ${product.promotionalPrice.toFixed(2)}</b>${discountLine}${shippingLine}`;
  }
}
