/**
 * Lista os grupos do WhatsApp da conta conectada com o JID de cada um e encerra.
 * Uso: npm run whatsapp-groups
 *
 * Não lê nem publica nada e não usa o Telegram. Na primeira vez, mostra um QR Code
 * para conectar a conta (WhatsApp → Dispositivos conectados → Conectar dispositivo).
 * A sessão fica em .local/whatsapp-session/ deste computador.
 */
import type { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import P from 'pino';
import qrcode from 'qrcode-terminal';

const SESSION_DIR = path.resolve(process.cwd(), '.local', 'whatsapp-session');

async function connect(): Promise<void> {
  const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
  } = await import('@whiskeysockets/baileys');

  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const logger = P({ level: 'silent' });
  const socket = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    markOnlineOnConnect: false,
  });

  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('Escaneie o QR Code: WhatsApp → Dispositivos conectados → Conectar dispositivo.');
    }

    if (connection === 'open') {
      const groups = Object.values(await socket.groupFetchAllParticipating()).sort((a, b) =>
        (a.subject || '').localeCompare(b.subject || ''),
      );

      if (groups.length === 0) {
        console.log('\nEsta conta não participa de nenhum grupo.');
      } else {
        console.log(`\n${groups.length} grupo(s). Copie o JID do grupo de destino para WHATSAPP_GROUP_JID:\n`);
        for (const group of groups) {
          console.log(`  ${(group.subject || '(sem nome)').padEnd(40)} ${group.id}`);
        }
        console.log('');
      }

      await socket.end(undefined).catch(() => undefined);
      process.exit(0);
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      // 515 é normal logo depois de escanear o QR: reconecta para terminar o login.
      if (statusCode === DisconnectReason.restartRequired) {
        connect().catch(fail);
        return;
      }
      if (statusCode === DisconnectReason.loggedOut) {
        fail(new Error('Sessão encerrada no celular. Apague .local/whatsapp-session e rode de novo.'));
        return;
      }
      fail(new Error(`Conexão encerrada (código ${statusCode ?? 'desconhecido'}). Rode o comando de novo.`));
    }
  });
}

function fail(error: unknown): void {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

connect().catch(fail);
