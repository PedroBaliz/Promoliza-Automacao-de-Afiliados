import { TelegramClient, utils } from 'telegram';
import { StringSession } from 'telegram/sessions';
import readline from 'readline';
import { config } from '../config/env.config';
import { extractUrls, resolveMercadoLivreLink, shortenUrl } from './link.service';

export type DealLinkHandler = (url: string, sourceCaption: string, image?: Buffer) => Promise<void>;

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY),
});

function prompt(label: string): Promise<string> {
  return new Promise((resolve) => {
    terminal.question(label, (answer) => resolve(answer.trim()));
  });
}

function normalizeCode(value: string): string {
  return value.replace(/\D/g, '');
}

function closePrompt(): void {
  terminal.close();
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

function collectMessageUrls(message: any): string[] {
  const text = message.message || '';
  const urls = extractUrls(text);

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

function removeLinksFromSourceText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\((?:https?:\/\/)[^\s)]+\)/gi, '$1')
    .replace(/https?:\/\/[^\s<>()]+/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+\n/g, '\n\n')
    .trim();
}

export class TelegramSourceService {
  private readonly client: TelegramClient;
  private sourceChats: Array<{ id: string; entity: any }> = [];
  private readonly lastMessageIds = new Map<string, number>();
  private polling = false;

  constructor(private readonly onDealLink: DealLinkHandler) {
    this.client = new TelegramClient(
      new StringSession(config.telegram.sourceSession),
      config.telegram.apiId,
      config.telegram.apiHash,
      { connectionRetries: 5 },
    );
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

    try {
      await this.client.start({
        phoneNumber: async () => config.telegram.sourcePhone,
        phoneCode: async () => normalizeCode(await prompt('Código recebido no Telegram: ')),
        password: async () => prompt('Senha 2FA do Telegram: '),
        onError: (error) => console.error('[TelegramSource] Erro de autenticação:', error),
      });
    } finally {
      closePrompt();
    }

    console.log('[TelegramSource] Conectado.');
    if (!config.telegram.sourceSession) {
      console.log('[TelegramSource] Sessão gerada; salve o valor exibido em TELEGRAM_SOURCE_SESSION.');
      console.log(this.client.session.save());
    }

    const sourceChats = await Promise.all(
      config.telegram.sourceChats.map(async (chat) => {
        const entity = await this.client.getEntity(chat);
        const chatId = utils.getPeerId(entity);
        console.log(`[TelegramSource] Chat de origem resolvido: ${chat} (${chatId})`);
        return { id: chatId, entity };
      }),
    );
    this.sourceChats = sourceChats;
    await this.initializePolling();
    setInterval(() => {
      void this.pollSourceChats();
    }, 10_000);
    console.log(`[TelegramSource] Monitorando ${sourceChats.length} chat(s) de origem.`);
  }

  private async initializePolling(): Promise<void> {
    for (const chat of this.sourceChats) {
      const messages = await this.client.getMessages(chat.entity, { limit: 1 });
      const latestMessage = messages[0];
      this.lastMessageIds.set(chat.id, latestMessage?.id || 0);
      console.log(
        `[TelegramSource] Ponto inicial: chat=${chat.id} mensagem=${latestMessage?.id || 'nenhuma'}.`,
      );
    }
  }

  private async pollSourceChats(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      for (const chat of this.sourceChats) {
        const messages = await this.client.getMessages(chat.entity, { limit: 20 });
        const lastMessageId = this.lastMessageIds.get(chat.id) || 0;
        const newMessages = messages
          .filter((message) => message.id > lastMessageId)
          .sort((left, right) => left.id - right.id);

        for (const message of newMessages) {
          try {
            await this.handleMessage(message, chat);
            this.lastMessageIds.set(chat.id, message.id);
          } catch (error: unknown) {
            console.error(
              `[TelegramSource] Falha ao processar mensagem=${message.id}; ` +
                'ela será tentada novamente no próximo ciclo:',
              error,
            );
            break;
          }
        }
      }
    } catch (error: unknown) {
      console.error('[TelegramSource] Erro ao consultar novas mensagens:', error);
    } finally {
      this.polling = false;
    }
  }

  private async handleMessage(message: any, chat: { id: string; entity: any }): Promise<void> {
    const text = message.message || '';
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
      console.log('[TelegramSource] Mensagem ignorada: nenhum URL HTTP/HTTPS no texto.');
      return;
    }

    for (const rawUrl of rawUrls) {
      const affiliateUrl = await resolveMercadoLivreLink(rawUrl);
      if (!affiliateUrl) {
        console.log(`[TelegramSource] URL ignorada: não é um link válido do Mercado Livre: ${rawUrl}`);
        continue;
      }

      const shortenedUrl = await shortenUrl(affiliateUrl);
      const sourceCaption = removeLinksFromSourceText(text);
      const hasImageMedia =
        Boolean(message.photo) ||
        message.media?.className === 'MessageMediaPhoto' ||
        message.document?.mimeType?.startsWith('image/');
      const downloadedMedia = hasImageMedia ? await this.client.downloadMedia(message, {}) : undefined;
      const image = Buffer.isBuffer(downloadedMedia) ? downloadedMedia : undefined;
      console.log(
        `[TelegramSource] Link do Mercado Livre encontrado; mídia=${image ? `${image.length} bytes` : 'não encontrada'}.`,
      );
      await this.onDealLink(shortenedUrl, sourceCaption, image);
    }
  }
}
