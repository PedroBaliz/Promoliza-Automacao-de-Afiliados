import { GoogleGenAI } from '@google/genai';
import { Product } from '../types';

export class AIService {
  private ai: GoogleGenAI;

  constructor() {
    // Inicializa a SDK da Gemini API usando a chave das variáveis de ambiente
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  /**
   * Gera uma legenda persuasiva e formatada em HTML para o Telegram
   */
  async generateCaption(product: Product): Promise<string> {
    try {
      const prompt = `
Você é um especialista em copywriting para canais de ofertas no Telegram.
Crie uma legenda altamente atrativa, curta e persuasiva para a seguinte promoção:

- Produto: ${product.title}
- Preço Original: R$ ${product.originalPrice.toFixed(2)}
- Preço Promocional: R$ ${product.promotionalPrice.toFixed(2)} (${product.discountPercentage}% OFF)
- Frete Grátis: ${product.freeShipping ? 'Sim' : 'Não'}

Diretrizes da resposta:
1. Use emojis adequados e chamativos.
2. Destaque o desconto percentual e a economia em reais.
3. Formate em HTML simples (use <b>texto</b> para negrito e <s>texto</s> para tachado).
4. Mantenha o texto objetivo e com menos de 70 palavras.
5. NÃO adicione links na resposta (o link de afiliado será anexado posteriormente).
`;

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      return response.text || this.getFallbackCaption(product);
    } catch (error) {
      console.error('Erro ao gerar legenda com Gemini API:', error);
      return this.getFallbackCaption(product);
    }
  }

  /**
   * Legenda padrão de segurança caso a API da IA falhe
   */
  private getFallbackCaption(product: Product): string {
    return (
      `🔥 <b>OFERTA IMPERDÍVEL!</b>\n\n` +
      `📦 <b>${product.title}</b>\n\n` +
      `💥 De: <s>R$ ${product.originalPrice.toFixed(2)}</s>\n` +
      `🏷️ Por apenas: <b>R$ ${product.promotionalPrice.toFixed(2)}</b> (${product.discountPercentage}% OFF)\n` +
      `${product.freeShipping ? '🚚 <b>Frete Grátis Disponível!</b>\n' : ''}`
    );
  }
}