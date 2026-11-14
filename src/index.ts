import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { config } from './config/env.config';
import { DatabaseService } from './services/database.service';
import { TelegramProvider } from './providers/telegram.provider';
import {
  DealSink,
  explainSessionError,
  isSessionInvalidError,
  TelegramSourceService,
} from './services/telegram-source.service';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { parseAffiliateTag } from './utils/affiliate';
import { buildCaption, TELEGRAM_TEXT_LIMIT } from './utils/caption';
import { describeError } from './utils/errors';

const app = express();
app.disable('x-powered-by');

const databaseService = new DatabaseService();
const telegramProvider = new TelegramProvider();
const whatsappProvider = new WhatsAppProvider();
let source: TelegramSourceService | null = null;

app.get('/', (_req, res) => {
  res.send('🤖 Promoliza Bot está rodando com sucesso!');
});

// Usado pelo healthcheck do Docker: 200 só enquanto o Telegram estiver de fato sendo lido.
app.get('/health', (_req, res) => {
  const healthy = source?.isHealthy() ?? false;
  res.status(healthy ? 200 : 503).json({ telegram: healthy ? 'ok' : 'indisponível' });
});

app.listen(config.port, () => {
  console.log(`🌐 [HTTP] Servidor Web ativo na porta ${config.port}`);
});

const dealSink: DealSink = {
  isAlreadyPosted: (dedupKey) => databaseService.isProductPosted(dedupKey),

  async publish({ dedupKey, affiliateUrl, sourceCaption, image }) {
    // Telegram é o canal principal: se falhar, o erro sobe e a mensagem é tentada de novo.
    await telegramProvider.sendConvertedMessage(sourceCaption, affiliateUrl, image);

    // Marca como enviada logo após o Telegram: se o processo cair durante o envio ao
    // WhatsApp, a oferta não é republicada no Telegram depois do reinício.
    databaseService.savePostedProduct(dedupKey);
    console.log(`✅ [Promoliza] Oferta convertida e enviada: ${affiliateUrl}`);

    // WhatsApp é opcional: vai para uma fila própria, então nem falha nem lentidão dele
    // atrasam ou bloqueiam o Telegram.
    if (whatsappProvider.enabled) {
      enqueueWhatsApp(buildCaption(sourceCaption, affiliateUrl, TELEGRAM_TEXT_LIMIT), image);
    }
  },
};

const MAX_WHATSAPP_QUEUE = 50;
let whatsappQueue: Promise<void> = Promise.resolve();
let whatsappPending = 0;

function enqueueWhatsApp(text: string, image?: Buffer): void {
  if (whatsappPending >= MAX_WHATSAPP_QUEUE) {
    console.warn('[WhatsApp] Fila cheia (WhatsApp lento ou fora do ar); oferta não enviada ao WhatsApp.');
    return;
  }
  whatsappPending++;
  whatsappQueue = whatsappQueue
    .then(() => whatsappProvider.sendMessage(text, image))
    .catch((error: unknown) => {
      console.error(`❌ [WhatsApp] Falha ao enviar oferta: ${describeError(error)}`);
    })
    .finally(() => {
      whatsappPending--;
    });
}

function validateAffiliateConfig(): void {
  const affiliateTag = parseAffiliateTag();
  if (affiliateTag.kind === 'invalid') {
    throw new Error(`ML_AFFILIATE_TAG inválida: ${affiliateTag.reason}.`);
  }
  if (affiliateTag.kind === 'none') {
    console.warn('⚠️ [Promoliza] ML_AFFILIATE_TAG não configurada: os links serão publicados SEM afiliação.');
  }
}

async function start(): Promise<void> {
  validateAffiliateConfig();

  if (whatsappProvider.enabled) {
    // Não espera o WhatsApp: ele conecta em paralelo e uma falha dele não impede o Telegram.
    whatsappProvider.start().catch((error: unknown) => {
      console.error(`❌ [WhatsApp] Falha ao iniciar; seguindo só com o Telegram: ${describeError(error)}`);
    });
  } else {
    console.log('[WhatsApp] WHATSAPP_GROUP_JID não configurado; publicação no WhatsApp desabilitada.');
  }

  source = new TelegramSourceService(dealSink, (error) => {
    console.error(`❌ [Promoliza] ${explainSessionError(error)}`);
    void shutdown(1);
  });
  await source.start();
}

let shuttingDown = false;

/**
 * Desconecta o Telegram antes de sair. Sem isso, a conexão antiga pode continuar
 * "viva" do lado do Telegram enquanto o próximo deploy conecta de outro IP com a mesma
 * sessão, o que gera AUTH_KEY_DUPLICATED e invalida a sessão.
 */
async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await source?.stop();
  process.exit(exitCode);
}

process.on('SIGTERM', () => {
  console.log('[Promoliza] SIGTERM recebido; desconectando do Telegram...');
  void shutdown(0);
});
process.on('SIGINT', () => void shutdown(0));

// Rede de segurança: registra sem derrubar o processo e sem imprimir objetos com segredos.
process.on('unhandledRejection', (reason) => {
  console.error(`❌ [Promoliza] Promessa rejeitada sem tratamento: ${describeError(reason)}`);
});

start().catch((error: unknown) => {
  const detail = isSessionInvalidError(error) ? explainSessionError(error) : describeError(error);
  console.error(`❌ [Promoliza] Não foi possível iniciar a leitura do Telegram: ${detail}`);
  // Desconecta e encerra para o Railway/Docker reiniciar, em vez de ficar de pé
  // (e conectado com a sessão) sem monitorar nada.
  void shutdown(1);
});
