import { TelegramClient, utils } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import readline from 'readline';
import { config } from '../config/env.config';
import { extractUrls, resolveMercadoLivreLink } from './link.service';

export type DealLinkHandler = (url: string, sourceText: string) => Promise<void>;

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

function validateSourceChats(chats: string[]): void {
  const invalidChats = chats.filter((chat) => /\s/.test(chat) && !/^-?\d+$/.test(chat));
  if (invalidChats.length > 0) {
    throw new Error(
      `TELEGRAM_SOURCE_CHATS contém identificadores inválidos: ${invalidChats.join(', ')}. ` +
        'Use @username ou o ID numérico do grupo, não o nome exibido.',
    );
  }
}

function collectMessageUrls(event: NewMessageEvent): string[] {
  const text = event.message.message || '';
  const urls = extractUrls(text);

  for (const entity of event.message.entities || []) {
    if (entity.className === 'MessageEntityTextUrl' && typeof entity.url === 'string') {
      urls.push(entity.url);
    }
  }

  for (const row of event.message.buttons || []) {
    for (const button of row) {
      if (button.url) urls.push(button.url);
    }
  }

  return [...new Set(urls)];
}

export class TelegramSourceService {
  private readonly client: TelegramClient;
  private sourceChatIds = new Set<string>();

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

    const sourceChatIds = await Promise.all(
      config.telegram.sourceChats.map(async (chat) => {
        const entity = await this.client.getEntity(chat);
        const chatId = utils.getPeerId(entity);
        console.log(`[TelegramSource] Chat de origem resolvido: ${chat} (${chatId})`);
        return chatId;
      }),
    );
    this.sourceChatIds = new Set(sourceChatIds);

    this.client.addEventHandler(
      async (event: NewMessageEvent) => {
        const chatId = event.chatId?.toString();
        if (!chatId || !this.sourceChatIds.has(chatId)) return;

        try {
          await this.handleMessage(event);
        } catch (error: unknown) {
          console.error('[TelegramSource] Erro ao processar mensagem:', error);
        }
      },
      new NewMessage(),
    );
    console.log(`[TelegramSource] Monitorando ${sourceChatIds.length} chat(s) de origem.`);
  }

  private async handleMessage(event: NewMessageEvent): Promise<void> {
    const text = event.message.message || '';
    const rawUrls = collectMessageUrls(event);
    console.log(
      `[TelegramSource] Nova mensagem recebida no chat ${event.message.chatId?.toString() || 'desconhecido'} ` +
        `(${rawUrls.length} URL(s) encontrada(s)).`,
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

      console.log('[TelegramSource] Link do Mercado Livre encontrado; enviando para o grupo de destino.');
      await this.onDealLink(affiliateUrl, text);
    }
  }
}
