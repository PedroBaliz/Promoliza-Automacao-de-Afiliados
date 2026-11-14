import axios from 'axios';
import { buildCaption, TELEGRAM_CAPTION_LIMIT, TELEGRAM_TEXT_LIMIT } from '../utils/caption';
import { describeError } from '../utils/errors';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Erro que não melhora com nova tentativa (ex.: mensagem rejeitada pelo Telegram).
 * Quem recebe pode descartar a mensagem em vez de tentar de novo para sempre.
 */
export class TelegramPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramPermanentError';
  }
}

/**
 * Falha do canal, não da mensagem (rede, 5xx, 429, token/permissão, configuração).
 * A mensagem deve ser tentada de novo depois de uma pausa, sem contar como tentativa perdida.
 */
export class TelegramTransientError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TelegramTransientError';
  }
}

// Erros 400 de configuração (chat/bot) devem continuar sendo tentados até alguém corrigir.
const CONFIG_ERROR_PATTERN =
  /chat not found|bot was (kicked|blocked)|not enough rights|have no rights|need administrator rights|not a member/i;
const MEDIA_ERROR_PATTERN = /photo|image|file|media|dimensions|too large|HTTP 413/i;

function toTelegramError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message = `Telegram ${describeError(error)}`;
    if ((status === 400 || status === 413) && !CONFIG_ERROR_PATTERN.test(message)) {
      return new TelegramPermanentError(message);
    }
    const retryAfter = (error.response?.data as { parameters?: { retry_after?: number } } | undefined)?.parameters
      ?.retry_after;
    return new TelegramTransientError(message, retryAfter ? retryAfter * 1000 : undefined);
  }
  return new TelegramTransientError(describeError(error));
}

export class TelegramProvider {
  private readonly botToken: string;
  private readonly chatId: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
  }

  async sendConvertedMessage(sourceCaption: string, affiliateUrl: string, image?: Buffer): Promise<void> {
    if (!this.botToken || !this.chatId) {
      throw new TelegramTransientError('Credenciais do Telegram não foram configuradas no .env');
    }

    const photoCaption = buildCaption(sourceCaption, affiliateUrl, TELEGRAM_CAPTION_LIMIT);
    // Se nem só o link cabe na legenda (URL longa sem encurtar), a oferta vai como texto.
    if (image && photoCaption.length <= TELEGRAM_CAPTION_LIMIT) {
      try {
        await this.sendPhoto(photoCaption, image);
        console.log('[TelegramProvider] Foto enviada com legenda.');
        return;
      } catch (error) {
        // Foto recusada (formato, tamanho, dimensões): publica a oferta só com o texto.
        if (!(error instanceof TelegramPermanentError) || !MEDIA_ERROR_PATTERN.test(error.message)) throw error;
        console.warn(`[TelegramProvider] Foto recusada (${error.message}); enviando só o texto.`);
      }
    }

    await this.sendText(buildCaption(sourceCaption, affiliateUrl, TELEGRAM_TEXT_LIMIT));
  }

  private async sendPhoto(caption: string, image: Buffer): Promise<void> {
    const form = new FormData();
    const imageData = new ArrayBuffer(image.byteLength);
    new Uint8Array(imageData).set(image);
    form.append('chat_id', this.chatId);
    form.append('photo', new Blob([imageData], { type: 'image/jpeg' }), 'promotion.jpg');
    form.append('caption', caption);
    await this.call('sendPhoto', form);
  }

  private async sendText(text: string): Promise<void> {
    await this.call('sendMessage', {
      chat_id: this.chatId,
      text,
      disable_web_page_preview: false,
    });
  }

  private async call(method: string, body: unknown): Promise<void> {
    let data: { ok?: boolean; description?: string };
    try {
      const response = await axios.post(`https://api.telegram.org/bot${this.botToken}/${method}`, body, {
        timeout: REQUEST_TIMEOUT_MS,
      });
      data = response.data;
    } catch (error) {
      throw toTelegramError(error);
    }

    if (!data?.ok) {
      throw new TelegramTransientError(`Telegram recusou a mensagem: ${data?.description || 'resposta inválida'}`);
    }
  }
}
