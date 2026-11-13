import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import P from 'pino';
import qrcode from 'qrcode-terminal';

const SESSION_DIR = path.resolve(process.cwd(), '.local', 'whatsapp-session');
const CONNECTION_WAIT_MS = 30_000;

export class WhatsAppProvider {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private readonly groupJid: string;
  private connected = false;
  private readonly connectionReady: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.groupJid = process.env.WHATSAPP_GROUP_JID || '';
    this.connectionReady = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  async start(): Promise<void> {
    if (!this.groupJid) {
      throw new Error('Configure WHATSAPP_GROUP_JID no .env para usar o WhatsAppProvider.');
    }
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    await this.connect();
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();
    const logger = P({ level: 'silent' });

    this.socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      markOnlineOnConnect: false,
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrcode.generate(qr, { small: true });
        console.log('[WhatsApp] Escaneie o QR Code acima com seu WhatsApp para conectar.');
        console.log('[WhatsApp] Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo.');
      }

      if (connection === 'open') {
        this.connected = true;
        this.resolveReady();
        console.log('[WhatsApp] Conectado com sucesso.');
      }

      if (connection === 'close') {
        this.connected = false;
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          console.log('[WhatsApp] Conexão encerrada; reconectando em 5s...');
          setTimeout(() => void this.connect(), 5_000);
        } else {
          console.error('[WhatsApp] Sessão encerrada (logout). Apague .local/whatsapp-session e reinicie.');
        }
      }
    });

    console.log('[WhatsApp] Iniciando conexão...');
  }

  async sendMessage(text: string, image?: Buffer): Promise<void> {
    if (!this.groupJid || !this.socket) return;

    if (!this.connected) {
      // Espera a primeira conexão por um tempo limitado para não travar a publicação no Telegram.
      await Promise.race([
        this.connectionReady,
        new Promise((resolve) => setTimeout(resolve, CONNECTION_WAIT_MS)),
      ]);
    }

    if (!this.connected) {
      console.warn('[WhatsApp] Não conectado; mensagem ignorada.');
      return;
    }

    if (image) {
      await this.socket.sendMessage(this.groupJid, { image, caption: text });
      console.log('[WhatsApp] Foto com legenda enviada.');
    } else {
      await this.socket.sendMessage(this.groupJid, { text });
      console.log('[WhatsApp] Mensagem de texto enviada.');
    }
  }
}
