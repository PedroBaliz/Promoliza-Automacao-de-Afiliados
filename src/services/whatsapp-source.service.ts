import type { WAMessage } from '@whiskeysockets/baileys';
import { TelegramPermanentError, TelegramTransientError } from '../providers/telegram.provider';
import type { WhatsAppProvider } from '../providers/whatsapp.provider';
import { describeError } from '../utils/errors';
import { sleep } from '../utils/timeout';
import { DealSink, publishDeals } from './deal-pipeline';
import { extractUrls } from './link.service';
import { extractBareLinks, removeLinksFromSourceText } from './telegram-source.service';

// Mensagem mais antiga que isso (ex.: entregue em atraso após uma reconexão longa) não é republicada.
const MAX_MESSAGE_AGE_MS = 15 * 60_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_QUEUE = 200;
const MAX_TRANSIENT_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 5 * 60_000;
const SEEN_IDS_LIMIT = 2_000;

// Invólucros que o WhatsApp põe em volta do conteúdo real (mensagens temporárias, visualização única etc.).
const WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
] as const;

export function unwrapContent(content: any): any {
  let current = content;
  for (let depth = 0; depth < 5 && current; depth++) {
    const key = WRAPPER_KEYS.find((name) => current[name]?.message);
    if (!key) break;
    current = current[key].message;
  }
  return current;
}

/** Texto completo da mensagem: texto simples, texto com prévia de link ou legenda de mídia. */
export function extractWhatsAppText(content: any): string {
  const c = unwrapContent(content);
  if (!c) return '';
  return (
    c.conversation ||
    c.extendedTextMessage?.text ||
    c.imageMessage?.caption ||
    c.videoMessage?.caption ||
    c.documentMessage?.caption ||
    ''
  );
}

export function collectWhatsAppUrls(content: any): string[] {
  const c = unwrapContent(content);
  const text = extractWhatsAppText(c);
  const urls = [...extractUrls(text), ...extractBareLinks(text)];
  // Link da prévia (card) que o WhatsApp mostra acima do texto.
  for (const value of [c?.extendedTextMessage?.matchedText, c?.extendedTextMessage?.canonicalUrl]) {
    if (typeof value === 'string' && value.trim()) {
      urls.push(/^https?:\/\//i.test(value) ? value.trim() : `https://${value.trim()}`);
    }
  }
  return [...new Set(urls)];
}

function hasDownloadableImage(content: any): boolean {
  const image = unwrapContent(content)?.imageMessage;
  if (!image) return false;
  const size = Number(image.fileLength?.toString?.() ?? image.fileLength ?? 0);
  return !Number.isFinite(size) || size <= MAX_IMAGE_BYTES;
}

function messageTimeMs(message: WAMessage): number | undefined {
  const raw = message.messageTimestamp as unknown;
  const seconds = Number((raw as { toString?: () => string })?.toString?.() ?? raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/**
 * Lê ofertas dos grupos de WhatsApp em WHATSAPP_SOURCE_JIDS e as publica pelo mesmo pipeline
 * do Telegram: texto inteiro da mensagem, foto (se houver) e link convertido para afiliado.
 * As mensagens são processadas uma por vez, em ordem de chegada.
 */
export class WhatsAppSourceService {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private readonly seenIds = new Set<string>();

  constructor(
    private readonly provider: WhatsAppProvider,
    private readonly sink: DealSink,
  ) {}

  start(): void {
    this.provider.onSourceMessage((message) => this.enqueue(message));
  }

  private enqueue(message: WAMessage): void {
    const id = `${message.key.remoteJid}:${message.key.id}`;
    if (this.seenIds.has(id)) return;
    this.seenIds.add(id);
    if (this.seenIds.size > SEEN_IDS_LIMIT) this.seenIds.delete(this.seenIds.values().next().value!);

    if (this.pending >= MAX_QUEUE) {
      console.warn('[WhatsAppSource] Fila cheia; mensagem de origem descartada.');
      return;
    }
    this.pending++;
    this.queue = this.queue
      .then(() => this.handleWithRetry(message))
      .catch((error: unknown) => {
        console.error(`❌ [WhatsAppSource] Mensagem=${message.key.id} descartada: ${describeError(error)}`);
      })
      .finally(() => {
        this.pending--;
      });
  }

  private async handleWithRetry(message: WAMessage): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.handleMessage(message);
        return;
      } catch (error) {
        // Publicação no Telegram fora do ar: espera e tenta de novo, sem perder a oferta.
        if (!(error instanceof TelegramTransientError) || attempt >= MAX_TRANSIENT_ATTEMPTS) throw error;
        const pauseMs = error.retryAfterMs ?? Math.min(MAX_BACKOFF_MS, 15_000 * 2 ** (attempt - 1));
        console.error(
          `[WhatsAppSource] Publicação indisponível; nova tentativa em ${Math.round(pauseMs / 1000)}s ` +
            `(tentativa ${attempt}/${MAX_TRANSIENT_ATTEMPTS}): ${describeError(error)}`,
        );
        await sleep(pauseMs);
      }
    }
  }

  private async handleMessage(message: WAMessage): Promise<void> {
    const sentAt = messageTimeMs(message);
    if (sentAt && Date.now() - sentAt > MAX_MESSAGE_AGE_MS) return;

    const text = extractWhatsAppText(message.message);
    const rawUrls = collectWhatsAppUrls(message.message);
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 100) || '[sem texto]';
    console.log(
      `[WhatsAppSource] Mensagem recebida: grupo=${message.key.remoteJid} mensagem=${message.key.id} ` +
        `"${preview}" (${rawUrls.length} URL(s) encontrada(s)).`,
    );

    if (rawUrls.length === 0) {
      console.log('[WhatsAppSource] Mensagem ignorada: nenhum link no texto.');
      return;
    }

    try {
      await publishDeals(
        {
          rawUrls,
          sourceCaption: removeLinksFromSourceText(text),
          loadImage: async () =>
            hasDownloadableImage(message.message) ? this.provider.downloadImage(message) : undefined,
          logTag: '[WhatsAppSource]',
        },
        this.sink,
      );
    } catch (error) {
      if (error instanceof TelegramPermanentError) {
        console.error(`❌ [WhatsAppSource] Telegram recusou a oferta: ${describeError(error)}`);
        return;
      }
      throw error;
    }
  }
}
