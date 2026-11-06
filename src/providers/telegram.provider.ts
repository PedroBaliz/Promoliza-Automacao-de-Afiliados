import axios from 'axios';
import { IMessengerProvider, OfferPayload } from '../types';

export class TelegramProvider implements IMessengerProvider {
  private readonly botToken: string;
  private readonly chatId: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
  }

  async sendOffer(payload: OfferPayload): Promise<void> {
    if (!this.botToken || !this.chatId) {
      throw new Error('Credenciais do Telegram não foram configuradas no .env');
    }

    if (!payload?.product?.thumbnail) {
      throw new Error('Não foi possível enviar a oferta: thumbnail do produto ausente.');
    }

    const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;
    const fullCaption = `${payload.caption}\n\n🛒 <b>Compre aqui:</b> <a href="${payload.affiliateUrl}">Acessar Oferta</a>`;

    await axios.post(url, {
      chat_id: this.chatId,
      photo: payload.product.thumbnail,
      caption: fullCaption,
      parse_mode: 'HTML',
    });
  }

  async sendDealMessage(caption: string, thumbnail: string, affiliateUrl: string): Promise<void> {
    await this.sendOffer({
      product: {
        id: 'telegram-fallback',
        title: 'Oferta',
        originalPrice: 0,
        promotionalPrice: 0,
        discountPercentage: 0,
        permalink: affiliateUrl,
        thumbnail,
        freeShipping: false,
      },
      caption,
      affiliateUrl,
    });
  }

  async sendConvertedMessage(sourceText: string, affiliateUrl: string): Promise<void> {
    if (!this.botToken || !this.chatId) {
      throw new Error('Credenciais do Telegram não foram configuradas no .env');
    }

    await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      chat_id: this.chatId,
      text: `${sourceText}\n\n🛒 Acessar oferta: ${affiliateUrl}`,
      disable_web_page_preview: false,
    });
  }
}