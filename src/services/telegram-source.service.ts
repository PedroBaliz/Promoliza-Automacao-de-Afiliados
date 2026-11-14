import { TelegramClient, errors, utils } from 'telegram';
import { StringSession } from 'telegram/sessions';
import readline from 'readline';
import { config } from '../config/env.config';
import { TelegramPermanentError, TelegramTransientError } from '../providers/telegram.provider';
import { describeError } from '../utils/errors';
import { withTimeout } from '../utils/timeout';
import { extractUrls, resolveMercadoLivreLink, shortenUrl } from './link.service';

export interface Deal {
  dedupKey: string;
  affiliateUrl: string;
  sourceCaption: string;
  image?: Buffer;
}

/** Destino das ofertas encontradas: quem decide se já foi publicada e quem publica. */
export interface DealSink {
  isAlreadyPosted(dedupKey: string): boolean;
  publish(deal: Deal): Promise<void>;
}

const POLL_INTERVAL_MS = 10_000;
const TELEGRAM_CALL_TIMEOUT_MS = 60_000;
const MESSAGES_PER_POLL = 100;
// Só para erros inesperados ligados à própria mensagem; falhas do canal não contam.
const MAX_ATTEMPTS_PER_MESSAGE = 10;
const MAX_PUBLISH_BACKOFF_MS = 5 * 60_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Sem uma consulta bem-sucedida nesse intervalo, /health passa a responder 503.
const HEALTHY_POLL_WINDOW_MS = 3 * 60_000;

// Links sem http(s) que o Telegram mostra como clicáveis e que não podem ir para o nosso canal.
const BARE_LINK_PATTERN =
  /(?<![\w@./])(?:www\.|t\.me\/|telegram\.me\/|wa\.me\/|chat\.whatsapp\.com\/|meli\.la\/|bit\.ly\/|tinyurl\.com\/|cutt\.ly\/|is\.gd\/|(?:[a-z0-9-]+\.)*mercadoli[vb]re\.com(?:\.br)?\/)\S*/gi;
// Linhas que só sobram como rótulo depois que o link foi removido ("🔗 Link:", "👉 Compre aqui").
const ORPHAN_LABEL_LINE =
  /^[ \t\p{Extended_Pictographic}️‍:➡-]*(?:link(?: d[ao] (?:oferta|produto))?|compre(?: aqui)?|comprar|acesse(?: aqui)?|clique aqui)[ \t\p{Extended_Pictographic}️‍:➡-]*$/gimu;

function prompt(label: string): Promise<string> {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    terminal.question(label, (answer) => {
      terminal.close();
      resolve(answer.trim());
    });
  });
}

function normalizeCode(value: string): string {
  return value.replace(/\D/g, '');
}

function messageDateToDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return new Date(value < 10_000_000_000 ? value * 1000 : value);
}

function validateSourceChats(chats: string[]): void {
  const invalidChats = chats.filter((chat) => /\s/.test(chat) && !/^-?\d+$/.test(chat));
  if (invalidChats.length > 0) {
    throw new Error(
      `TELEGRAM_SOURCE_CHATS contém identificadores inválidos: ${invalidChats.join(', ')}. ` +
        'Use @username ou o ID numérico do grupo, não o nome exibido.',
    );
  }
}

function urlEntityRanges(message: any): Array<{ offset: number; length: number }> {
  return (message.entities || [])
    .filter((entity: any) => entity.className === 'MessageEntityUrl')
    .map((entity: any) => ({ offset: entity.offset, length: entity.length }));
}

export function collectMessageUrls(message: any): string[] {
  const text: string = message.message || '';
  const urls = extractUrls(text);

  // Links sem esquema (ex.: "meli.la/abc") chegam como MessageEntityUrl; offsets são UTF-16, como no JS.
  for (const { offset, length } of urlEntityRanges(message)) {
    const value = text.slice(offset, offset + length).trim();
    if (value) urls.push(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  }

  for (const entity of message.entities || []) {
    if (entity.className === 'MessageEntityTextUrl' && typeof entity.url === 'string') {
      urls.push(entity.url);
    }
  }

  for (const row of message.buttons || []) {
    for (const button of row) {
      if (button.url) urls.push(button.url);
    }
  }

  return [...new Set(urls)];
}

export function removeLinksFromSourceText(text: string, entities: any[] = []): string {
  let result = text;

  // Remove do fim para o começo para os offsets das entidades continuarem válidos.
  const ranges = urlEntityRanges({ entities }).sort((a, b) => b.offset - a.offset);
  for (const { offset, length } of ranges) {
    result = result.slice(0, offset) + result.slice(offset + length);
  }

  return result
    .replace(/\[([^\]]*)\]\((?:https?:\/\/)[^\s)]+\)/gi, '$1')
    .replace(/https?:\/\/[^\s<>()]+/gi, '')
    .replace(BARE_LINK_PATTERN, '')
    .replace(ORPHAN_LABEL_LINE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type SourceChat = { id: string; entity: any };

export class TelegramSourceService {
  private readonly client: TelegramClient;
  private sourceChats: SourceChat[] = [];
  private readonly lastMessageIds = new Map<string, number>();
  private readonly failedAttempts = new Map<string, number>();
  private polling = false;
  private pausedUntil = 0;
  private publishFailures = 0;
  private lastSuccessfulPollAt = 0;

  constructor(private readonly sink: DealSink) {
    this.client = new TelegramClient(
      new StringSession(config.telegram.sourceSession),
      config.telegram.apiId,
      config.telegram.apiHash,
      // O bot roda 24h: continua tentando reconectar em vez de desistir após poucas falhas.
      { connectionRetries: Number.POSITIVE_INFINITY, retryDelay: 5_000 },
    );
  }

  isHealthy(): boolean {
    return this.lastSuccessfulPollAt > 0 && Date.now() - this.lastSuccessfulPollAt < HEALTHY_POLL_WINDOW_MS;
  }

  async start(): Promise<void> {
    if (
      !config.telegram.apiId ||
      !config.telegram.apiHash ||
      !config.telegram.sourcePhone ||
      config.telegram.sourceChats.length === 0
    ) {
      throw new Error(
        'Configure TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SOURCE_PHONE e TELEGRAM_SOURCE_CHATS para ler grupos.',
      );
    }

    validateSourceChats(config.telegram.sourceChats);

    if (!config.telegram.sourceSession && !process.stdin.isTTY) {
      throw new Error(
        'TELEGRAM_SOURCE_SESSION está vazio e não há terminal interativo para fazer login. ' +
          'Gere a sessão rodando `npm run dev` no seu computador e cole o valor no .env.',
      );
    }

    await this.client.start({
      phoneNumber: async () => config.telegram.sourcePhone,
      phoneCode: async () => normalizeCode(await prompt('Código recebido no Telegram: ')),
      password: async () => prompt('Senha 2FA do Telegram: '),
      onError: (error) => console.error(`[TelegramSource] Erro de autenticação: ${describeError(error)}`),
    });

    console.log('[TelegramSource] Conectado.');
    if (!config.telegram.sourceSession) {
      // Só chega aqui com terminal interativo (verificado acima), nunca em logs de produção.
      console.log('[TelegramSource] Sessão gerada. Salve o valor abaixo em TELEGRAM_SOURCE_SESSION.');
      console.log('[TelegramSource] ATENÇÃO: esse valor dá acesso total à sua conta. Não compartilhe.');
      console.log(this.client.session.save());
    }

    this.sourceChats = await this.resolveSourceChats();
    await this.initializePolling();
    this.lastSuccessfulPollAt = Date.now();
    setInterval(() => {
      void this.pollSourceChats();
    }, POLL_INTERVAL_MS);
    console.log(`[TelegramSource] Monitorando ${this.sourceChats.length} chat(s) de origem.`);
  }

  private async resolveSourceChats(): Promise<SourceChat[]> {
    // A StringSession não guarda o cache de entidades: IDs numéricos só resolvem depois
    // de carregar os diálogos da conta.
    if (config.telegram.sourceChats.some((chat) => /^-?\d+$/.test(chat))) {
      try {
        await this.client.getDialogs({ limit: 500 });
      } catch (error) {
        console.warn(`[TelegramSource] Não foi possível carregar os diálogos: ${describeError(error)}`);
      }
    }

    const results = await Promise.allSettled(
      config.telegram.sourceChats.map(async (chat) => {
        const entity = await this.client.getEntity(chat);
        const chatId = utils.getPeerId(entity);
        console.log(`[TelegramSource] Chat de origem resolvido: ${chat} (${chatId})`);
        return { id: chatId, entity };
      }),
    );

    const resolved: SourceChat[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') resolved.push(result.value);
      else {
        console.error(
          `❌ [TelegramSource] Não foi possível resolver o chat "${config.telegram.sourceChats[index]}": ` +
            describeError(result.reason),
        );
      }
    });

    if (resolved.length === 0) {
      throw new Error('Nenhum chat de TELEGRAM_SOURCE_CHATS pôde ser resolvido.');
    }
    return resolved;
  }

  private async initializePolling(): Promise<void> {
    for (const chat of this.sourceChats) {
      const messages = await withTimeout(
        this.client.getMessages(chat.entity, { limit: 1 }),
        TELEGRAM_CALL_TIMEOUT_MS,
        '[TelegramSource] leitura inicial',
      );
      const latestMessage = messages[0];
      this.lastMessageIds.set(chat.id, latestMessage?.id || 0);
      console.log(
        `[TelegramSource] Ponto inicial: chat=${chat.id} mensagem=${latestMessage?.id || 'nenhuma'}.`,
      );
    }
  }

  private async pollSourceChats(): Promise<void> {
    if (this.polling || Date.now() < this.pausedUntil) return;
    this.polling = true;

    try {
      let anyChatRead = false;
      for (const chat of this.sourceChats) {
        // Um chat com erro (ex.: grupo que ficou privado) não impede a leitura dos outros.
        try {
          await this.pollChat(chat);
          anyChatRead = true;
        } catch (error: unknown) {
          if (error instanceof errors.FloodWaitError || error instanceof TelegramTransientError) throw error;
          console.error(`[TelegramSource] Erro ao consultar o chat ${chat.id}: ${describeError(error)}`);
        }
      }
      if (anyChatRead) this.lastSuccessfulPollAt = Date.now();
      this.publishFailures = 0;
    } catch (error: unknown) {
      if (error instanceof errors.FloodWaitError) {
        this.pausedUntil = Date.now() + error.seconds * 1000;
        console.warn(`[TelegramSource] FloodWait do Telegram: pausando a leitura por ${error.seconds}s.`);
      } else if (error instanceof TelegramTransientError) {
        // Problema no canal de publicação (rede, 5xx, 429, token, permissão): pausa sem descartar ofertas.
        this.publishFailures++;
        const backoff = Math.min(MAX_PUBLISH_BACKOFF_MS, 15_000 * 2 ** (this.publishFailures - 1));
        const pauseMs = error.retryAfterMs ?? backoff;
        this.pausedUntil = Date.now() + pauseMs;
        console.error(
          `[TelegramSource] Publicação no Telegram indisponível; nova tentativa em ${Math.round(pauseMs / 1000)}s ` +
            `(nenhuma oferta descartada): ${describeError(error)}`,
        );
      } else {
        console.error(`[TelegramSource] Erro ao consultar novas mensagens: ${describeError(error)}`);
      }
    } finally {
      this.polling = false;
    }
  }

  private async pollChat(chat: SourceChat): Promise<void> {
    const lastMessageId = this.lastMessageIds.get(chat.id) || 0;
    // reverse: da mais antiga para a mais nova a partir de minId, então um acúmulo maior
    // que MESSAGES_PER_POLL é lido nos próximos ciclos em vez de ter o começo pulado.
    const messages = await withTimeout(
      this.client.getMessages(chat.entity, { minId: lastMessageId, limit: MESSAGES_PER_POLL, reverse: true }),
      TELEGRAM_CALL_TIMEOUT_MS,
      '[TelegramSource] consulta de mensagens',
    );
    const newMessages = messages
      .filter((message) => message.id > lastMessageId)
      .sort((left, right) => left.id - right.id);

    for (const message of newMessages) {
      const attemptKey = `${chat.id}:${message.id}`;
      try {
        await this.handleMessage(message, chat);
        this.markProcessed(chat, message.id, attemptKey);
      } catch (error: unknown) {
        // Falhas do canal sobem sem contar tentativa: a mensagem fica para depois da pausa.
        if (error instanceof errors.FloodWaitError || error instanceof TelegramTransientError) throw error;

        const attempts = (this.failedAttempts.get(attemptKey) || 0) + 1;
        if (error instanceof TelegramPermanentError || attempts >= MAX_ATTEMPTS_PER_MESSAGE) {
          console.error(
            `❌ [TelegramSource] Mensagem=${message.id} descartada após ${attempts} tentativa(s): ${describeError(error)}`,
          );
          this.markProcessed(chat, message.id, attemptKey);
          continue;
        }

        this.failedAttempts.set(attemptKey, attempts);
        console.error(
          `[TelegramSource] Falha ao processar mensagem=${message.id} ` +
            `(tentativa ${attempts}/${MAX_ATTEMPTS_PER_MESSAGE}); nova tentativa no próximo ciclo: ${describeError(error)}`,
        );
        break;
      }
    }
  }

  private markProcessed(chat: SourceChat, messageId: number, attemptKey: string): void {
    this.lastMessageIds.set(chat.id, messageId);
    this.failedAttempts.delete(attemptKey);
  }

  private async handleMessage(message: any, chat: SourceChat): Promise<void> {
    const text: string = message.message || '';
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 100) || '[sem texto]';
    const rawUrls = collectMessageUrls(message);
    const messageDate = messageDateToDate(message.date);
    const messageTime = messageDate
      ? new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'medium',
          timeZone: 'America/Sao_Paulo',
        }).format(messageDate)
      : 'horário desconhecido';
    const chatName =
      chat.entity.title ||
      (chat.entity.username ? `@${chat.entity.username}` : undefined) ||
      chat.id;
    console.log(
      `[TelegramSource] Mensagem recebida: grupo="${chatName}" horário=${messageTime} ` +
        `chat=${chat.id} mensagem=${message.id} ` +
        `"${preview}" (${rawUrls.length} URL(s) encontrada(s)).`,
    );

    if (rawUrls.length === 0) {
      console.log('[TelegramSource] Mensagem ignorada: nenhum link no texto.');
      return;
    }

    const sourceCaption = removeLinksFromSourceText(text, message.entities);
    const seenKeys = new Set<string>();
    let image: Buffer | undefined;
    let imageLoaded = false;

    for (const rawUrl of rawUrls) {
      const deal = await resolveMercadoLivreLink(rawUrl);
      if (!deal) {
        console.log(`[TelegramSource] URL ignorada: não é um link válido do Mercado Livre: ${rawUrl}`);
        continue;
      }

      // Checa a duplicidade antes de encurtar e baixar a mídia, para não gastar requisições.
      if (seenKeys.has(deal.dedupKey) || this.sink.isAlreadyPosted(deal.dedupKey)) {
        console.log(`[Promoliza] Oferta ignorada: ${deal.dedupKey} já enviada nos últimos 30 dias.`);
        continue;
      }
      seenKeys.add(deal.dedupKey);

      const shortenedUrl = await shortenUrl(deal.affiliateUrl);
      if (!imageLoaded) {
        image = await this.downloadImage(message);
        imageLoaded = true;
      }
      console.log(
        `[TelegramSource] Link do Mercado Livre encontrado; mídia=${image ? `${image.length} bytes` : 'não encontrada'}.`,
      );
      await this.sink.publish({ dedupKey: deal.dedupKey, affiliateUrl: shortenedUrl, sourceCaption, image });
    }
  }

  private async downloadImage(message: any): Promise<Buffer | undefined> {
    const isPhoto = Boolean(message.photo) || message.media?.className === 'MessageMediaPhoto';
    const document = message.document;
    const isImageDocument = /^image\/(jpeg|png|webp)$/i.test(document?.mimeType || '');
    if (!isPhoto && !isImageDocument) return undefined;

    if (!isPhoto) {
      const size = Number(document.size?.toString?.() ?? document.size);
      if (!Number.isFinite(size) || size > MAX_IMAGE_BYTES) {
        console.warn(`[TelegramSource] Imagem ignorada: tamanho ${size} bytes acima do limite.`);
        return undefined;
      }
    }

    try {
      const media = await withTimeout(
        this.client.downloadMedia(message, {}),
        TELEGRAM_CALL_TIMEOUT_MS,
        '[TelegramSource] download de mídia',
      );
      if (!Buffer.isBuffer(media) || media.length > MAX_IMAGE_BYTES) return undefined;
      return media;
    } catch (error) {
      if (error instanceof errors.FloodWaitError) throw error;
      // A oferta segue sem imagem em vez de travar a mensagem.
      console.warn(`[TelegramSource] Não foi possível baixar a imagem: ${describeError(error)}`);
      return undefined;
    }
  }
}
