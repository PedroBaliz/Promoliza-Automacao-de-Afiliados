// Baileys é um pacote ESM e só é carregado quando o WhatsApp está habilitado.
// Com "module": "CommonJS", o TypeScript compila o import() abaixo para require(),
// o que exige Node >= 22.12 (require de ESM sem flag).
import type { WASocket, WAVersion } from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import P from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from '../config/env.config';
import { describeError } from '../utils/errors';
import { sleep, withTimeout } from '../utils/timeout';

type Baileys = typeof import('@whiskeysockets/baileys');

const SESSION_DIR = path.resolve(process.cwd(), '.local', 'whatsapp-session');
// Só logo após o boot vale esperar a conexão; depois disso, sem conexão = ignora na hora.
const INITIAL_CONNECTION_WAIT_MS = 30_000;
const SEND_TIMEOUT_MS = 30_000;
const VERSION_FETCH_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 5 * 60_000;

export class WhatsAppProvider {
  private baileys: Baileys | null = null;
  private version: WAVersion | undefined;
  private socket: WASocket | null = null;
  private connected = false;
  private stopped = false;
  private startedAt = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private readonly connectionReady: Promise<void>;
  private resolveReady!: () => void;

  constructor(private readonly groupJid: string = config.whatsapp.groupJid) {
    this.connectionReady = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  get enabled(): boolean {
    return Boolean(this.groupJid);
  }

  async start(): Promise<void> {
    if (!this.groupJid) {
      throw new Error('Configure WHATSAPP_GROUP_JID no .env para usar o WhatsAppProvider.');
    }
    this.startedAt = Date.now();
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    this.baileys = await import('@whiskeysockets/baileys');

    // Busca a versão uma única vez (não a cada reconexão) e sem travar a inicialização.
    try {
      const { version } = await withTimeout(
        this.baileys.fetchLatestBaileysVersion(),
        VERSION_FETCH_TIMEOUT_MS,
        '[WhatsApp] versão do Baileys',
      );
      this.version = version;
    } catch (error) {
      console.warn(`[WhatsApp] Não foi possível buscar a versão mais recente; usando a embutida: ${describeError(error)}`);
    }

    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped || !this.baileys) return;
    const { default: makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } = this.baileys;
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const logger = P({ level: 'silent' });

    this.disposeSocket();
    const socket = makeWASocket({
      ...(this.version ? { version: this.version } : {}),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      markOnlineOnConnect: false,
    });
    this.socket = socket;
    let pairingRequested = false;

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', (update) => {
      // Evento atrasado de um socket antigo não pode mexer no estado do atual.
      if (socket !== this.socket) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr && config.whatsapp.pairingPhone && !state.creds.registered) {
        // Código de pareamento: alternativa ao QR, que fica grande demais em painéis de log.
        if (!pairingRequested) {
          pairingRequested = true;
          socket
            .requestPairingCode(config.whatsapp.pairingPhone)
            .then((code) => {
              const formatted = code.match(/.{1,4}/g)?.join('-') ?? code;
              console.log(`[WhatsApp] Código de pareamento: ${formatted}`);
              console.log(
                '[WhatsApp] No celular: WhatsApp → Dispositivos conectados → Conectar dispositivo → ' +
                  '"Conectar com número de telefone" e digite o código acima.',
              );
            })
            .catch((error: unknown) => {
              console.error(`❌ [WhatsApp] Não foi possível gerar o código de pareamento: ${describeError(error)}`);
            });
        }
      } else if (qr) {
        qrcode.generate(qr, { small: true });
        console.log('[WhatsApp] Escaneie o QR Code acima com seu WhatsApp para conectar.');
        console.log('[WhatsApp] Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo.');
        console.log('[WhatsApp] QR grande demais? Defina WHATSAPP_PAIRING_PHONE para conectar por código.');
      }

      if (connection === 'open') {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.resolveReady();
        console.log('[WhatsApp] Conectado com sucesso.');
      }

      if (connection === 'close') {
        this.connected = false;
        this.handleClose((lastDisconnect?.error as Boom | undefined)?.output?.statusCode);
      }
    });

    console.log('[WhatsApp] Iniciando conexão...');
  }

  private handleClose(statusCode: number | undefined): void {
    const reason = this.baileys!.DisconnectReason;

    const fatal: Record<number, string> = {
      [reason.loggedOut]: 'Sessão encerrada (logout). Apague .local/whatsapp-session e reinicie para gerar um novo QR Code.',
      [reason.connectionReplaced]:
        'Outra instância está usando a mesma sessão do WhatsApp (ex.: local e Docker ao mesmo tempo). Deixe só uma rodando e reinicie.',
      [reason.forbidden]: 'O WhatsApp recusou a conexão (403). Verifique a conta e reinicie.',
      [reason.multideviceMismatch]: 'Sessão incompatível. Apague .local/whatsapp-session e reinicie.',
    };

    if (statusCode !== undefined && fatal[statusCode]) {
      this.stopped = true;
      this.disposeSocket();
      console.error(`❌ [WhatsApp] ${fatal[statusCode]} Publicação no WhatsApp desativada; o Telegram continua normalmente.`);
      return;
    }

    // 515 é esperado logo depois de escanear o QR: reconecta na hora.
    this.scheduleReconnect(statusCode === reason.restartRequired ? 0 : undefined, statusCode);
  }

  private scheduleReconnect(delayMs?: number, statusCode?: number): void {
    if (this.stopped) return;
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    const delay = delayMs ?? backoff + Math.floor(Math.random() * 1_000);
    this.reconnectAttempts++;

    console.log(`[WhatsApp] Conexão encerrada (código ${statusCode ?? 'desconhecido'}); reconectando em ${Math.round(delay / 1000)}s...`);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error: unknown) => {
        console.error(`❌ [WhatsApp] Falha ao reconectar: ${describeError(error)}`);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private disposeSocket(): void {
    const oldSocket = this.socket;
    if (!oldSocket) return;
    this.socket = null;
    oldSocket.ev.removeAllListeners('connection.update');
    oldSocket.ev.removeAllListeners('creds.update');
    oldSocket.end(undefined).catch(() => undefined);
  }

  async sendMessage(text: string, image?: Buffer): Promise<void> {
    if (!this.groupJid || this.stopped) return;

    if (!this.connected) {
      const remaining = INITIAL_CONNECTION_WAIT_MS - (Date.now() - this.startedAt);
      if (remaining > 0) await Promise.race([this.connectionReady, sleep(remaining)]);
    }

    const socket = this.socket;
    if (!this.connected || !socket) {
      console.warn('[WhatsApp] Não conectado; mensagem ignorada.');
      return;
    }

    const content = image ? { image, caption: text } : { text };
    await withTimeout(socket.sendMessage(this.groupJid, content), SEND_TIMEOUT_MS, '[WhatsApp] envio');
    console.log(image ? '[WhatsApp] Foto com legenda enviada.' : '[WhatsApp] Mensagem de texto enviada.');
  }
}
