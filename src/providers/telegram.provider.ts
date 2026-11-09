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

    const response = await axios.post(url, {
      chat_id: this.chatId,
      photo: payload.product.thumbnail,
      caption: fullCaption,
      parse_mode: 'HTML',
    });

    this.assertTelegramSuccess(response.data);
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

  async sendConvertedMessage(sourceText: string, affiliateUrl: string, image?: Buffer): Promise<void> {
    if (!this.botToken || !this.chatId) {
      throw new Error('Credenciais do Telegram não foram configuradas no .env');
    }

    const caption = `${sourceText}\n\n🛒 Acessar oferta: ${affiliateUrl}`;
    let response;

    if (image) {
      const form = new FormData();
      const imageData = new ArrayBuffer(image.byteLength);
      new Uint8Array(imageData).set(image);
      form.append('chat_id', this.chatId);
      form.append('photo', new Blob([imageData], { type: 'image/jpeg' }), 'promotion.jpg');
      form.append('caption', caption);
      response = await axios.post(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, form);
    } else {
      response = await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        chat_id: this.chatId,
        text: caption,
        disable_web_page_preview: false,
      });
    }

    this.assertTelegramSuccess(response.data);
  }

  private assertTelegramSuccess(response: { ok?: boolean; description?: string }): void {
    if (!response.ok) {
      throw new Error(`Telegram recusou a mensagem: ${response.description || 'resposta inválida'}`);
    }
  }
}