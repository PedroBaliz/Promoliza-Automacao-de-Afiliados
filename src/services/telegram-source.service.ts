import { TelegramClient } from 'telegram';
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

export class TelegramSourceService {
  private readonly client: TelegramClient;

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

    console.log('[TelegramSource] Conectado. Sessão atualizada; salve TELEGRAM_SOURCE_SESSION se necessário.');
    console.log(this.client.session.save());

    this.client.addEventHandler(
      async (event: NewMessageEvent) => {
        try {
          await this.handleMessage(event);
        } catch (error: unknown) {
          console.error('[TelegramSource] Erro ao processar mensagem:', error);
        }
      },
      new NewMessage({ chats: config.telegram.sourceChats }),
    );
  }

  private async handleMessage(event: NewMessageEvent): Promise<void> {
    const text = event.message.message || '';
    for (const rawUrl of extractUrls(text)) {
      const affiliateUrl = await resolveMercadoLivreLink(rawUrl);
      if (affiliateUrl) await this.onDealLink(affiliateUrl, text);
    }
  }
}
