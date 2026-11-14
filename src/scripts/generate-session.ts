/**
 * Gera uma nova TELEGRAM_SOURCE_SESSION e encerra: não lê grupos nem publica nada.
 * Uso: npm run session
 *
 * Sempre cria uma sessão nova (ignora a TELEGRAM_SOURCE_SESSION atual do .env).
 * Depois de colar o valor na produção, não use a mesma sessão em dois lugares ao
 * mesmo tempo: o Telegram responde AUTH_KEY_DUPLICATED e invalida a sessão.
 */
import dotenv from 'dotenv';
dotenv.config();

import readline from 'readline';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

function ask(terminal: readline.Interface, label: string): Promise<string> {
  return new Promise((resolve) => terminal.question(label, (answer) => resolve(answer.trim())));
}

async function main(): Promise<void> {
  const apiId = Number.parseInt(process.env.TELEGRAM_API_ID || '', 10);
  const apiHash = process.env.TELEGRAM_API_HASH || '';
  const phone = process.env.TELEGRAM_SOURCE_PHONE || '';
  if (!apiId || !apiHash || !phone) {
    throw new Error('Configure TELEGRAM_API_ID, TELEGRAM_API_HASH e TELEGRAM_SOURCE_PHONE no .env.');
  }

  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

  try {
    await client.start({
      phoneNumber: async () => phone,
      phoneCode: async () => (await ask(terminal, 'Código recebido no Telegram: ')).replace(/\D/g, ''),
      password: async () => ask(terminal, 'Senha de verificação em duas etapas: '),
      onError: (error) => console.error(`Erro de autenticação: ${error.message}`),
    });

    const session = client.session.save() as unknown as string;
    console.log('\n✅ Sessão gerada. Cole o valor abaixo em TELEGRAM_SOURCE_SESSION na produção.');
    console.log('⚠️  Esse valor dá acesso total à sua conta do Telegram. Não compartilhe.\n');
    console.log(session);
    console.log('');
  } finally {
    terminal.close();
    await client.destroy().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`❌ Não foi possível gerar a sessão: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
