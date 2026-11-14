import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import { TelegramPermanentError, TelegramProvider, TelegramTransientError } from './telegram.provider';

const TOKEN = '987654321:AAFakeTokenForProviderTests_xyz12345';
const CHAT_ID = '-100123456789';
const LINK = 'https://is.gd/abc123';

const savedEnv = { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID };

function telegramHttpError(url: string, status: number, description?: string): AxiosError {
  const config = { url, headers: new AxiosHeaders() } as any;
  const response = { status, statusText: '', data: description ? { ok: false, description } : '', headers: {}, config } as any;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, response);
}

type Call = { method: string; body: any };

/** Mocka axios.post; `handler` decide a resposta por método da Bot API. */
function mockPost(handler: (method: string) => { status: number; description?: string } | undefined) {
  const calls: Call[] = [];
  mock.method(axios, 'post', async (url: string, body: unknown) => {
    const method = url.split('/').pop() as string;
    calls.push({ method, body });
    const failure = handler(method);
    if (failure) throw telegramHttpError(url, failure.status, failure.description);
    return { status: 200, data: { ok: true, result: {} } };
  });
  return calls;
}

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_CHAT_ID = CHAT_ID;
  mock.method(console, 'log', () => {});
  mock.method(console, 'warn', () => {});
});

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of [
    ['TELEGRAM_BOT_TOKEN', savedEnv.token],
    ['TELEGRAM_CHAT_ID', savedEnv.chat],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('TelegramProvider', () => {
  test('sem credenciais lança erro sem chamar a API', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const calls = mockPost(() => undefined);
    await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK), /Credenciais/);
    assert.equal(calls.length, 0);
  });

  test('sem imagem envia sendMessage com texto e link', async () => {
    const calls = mockPost(() => undefined);
    await new TelegramProvider().sendConvertedMessage('Oferta', LINK);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'sendMessage');
    assert.equal(calls[0].body.chat_id, CHAT_ID);
    assert.ok(calls[0].body.text.endsWith(LINK));
  });

  test('com imagem envia sendPhoto com legenda ≤ 1024 mesmo com texto longo', async () => {
    const calls = mockPost(() => undefined);
    await new TelegramProvider().sendConvertedMessage('a'.repeat(5000), LINK, Buffer.from([0xff, 0xd8, 0xff]));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'sendPhoto');
    const form = calls[0].body as FormData;
    const caption = String(form.get('caption'));
    assert.ok(caption.length <= 1024, `legenda com ${caption.length}`);
    assert.ok(caption.endsWith(LINK));
    assert.equal(form.get('chat_id'), CHAT_ID);
    assert.ok(form.get('photo') instanceof Blob);
  });

  test('400 comum vira TelegramPermanentError', async () => {
    mockPost(() => ({ status: 400, description: 'Bad Request: message text is empty' }));
    await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK), TelegramPermanentError);
  });

  test('400 "chat not found" não é permanente (erro de configuração)', async () => {
    mockPost(() => ({ status: 400, description: 'Bad Request: chat not found' }));
    await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK), (error: Error) => {
      assert.ok(!(error instanceof TelegramPermanentError));
      assert.match(error.message, /chat not found/);
      return true;
    });
  });

  test('429 e 500 não são permanentes', async () => {
    for (const status of [429, 500]) {
      mockPost(() => ({ status, description: 'Too Many Requests: retry after 5' }));
      await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK), (error: Error) => {
        assert.ok(!(error instanceof TelegramPermanentError), String(status));
        return true;
      });
      mock.restoreAll();
    }
  });

  test('mensagem de erro nunca contém o token do bot', async () => {
    for (const status of [400, 401, 429, 500]) {
      mockPost(() => ({ status, description: 'falhou' }));
      await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK), (error: Error) => {
        assert.ok(!error.message.includes(TOKEN), error.message);
        assert.ok(!error.message.includes('AAFakeToken'), error.message);
        assert.ok(!String(error.stack).includes('AAFakeToken'));
        return true;
      });
      mock.restoreAll();
    }
  });

  test('erro de rede sem resposta também não expõe o token', async () => {
    mock.method(axios, 'post', async (url: string) => {
      const config = { url, headers: new AxiosHeaders() } as any;
      throw new AxiosError(`connect ETIMEDOUT ${url}`, undefined, config);
    });
    await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK), (error: Error) => {
      assert.ok(!error.message.includes('AAFakeToken'), error.message);
      return true;
    });
  });

  test('foto recusada (PHOTO_INVALID_DIMENSIONS) faz fallback para sendMessage', async () => {
    const calls = mockPost((method) =>
      method === 'sendPhoto' ? { status: 400, description: 'Bad Request: PHOTO_INVALID_DIMENSIONS' } : undefined,
    );
    await new TelegramProvider().sendConvertedMessage('b'.repeat(3000), LINK, Buffer.from([1, 2, 3]));
    assert.deepEqual(calls.map((c) => c.method), ['sendPhoto', 'sendMessage']);
    // No fallback o limite volta a ser o de texto (4096), então o texto de 3000 cabe inteiro.
    assert.ok(calls[1].body.text.startsWith('b'.repeat(3000)));
  });

  test('foto grande demais (HTTP 413) faz fallback para sendMessage', async () => {
    // A Bot API responde 413 "Request Entity Too Large" quando o upload passa do limite.
    const calls = mockPost((method) =>
      method === 'sendPhoto' ? { status: 413, description: 'Request Entity Too Large' } : undefined,
    );
    await new TelegramProvider().sendConvertedMessage('Oferta', LINK, Buffer.from([1, 2, 3]));
    assert.deepEqual(calls.map((c) => c.method), ['sendPhoto', 'sendMessage']);
  });

  test('foto com erro não relacionado à mídia não faz fallback', async () => {
    const calls = mockPost((method) => (method === 'sendPhoto' ? { status: 500, description: 'Internal' } : undefined));
    await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK, Buffer.from([1])));
    assert.deepEqual(calls.map((c) => c.method), ['sendPhoto']);
  });

  test('resposta 200 com ok=false lança erro não permanente', async () => {
    mock.method(axios, 'post', async () => ({ status: 200, data: { ok: false, description: 'algo' } }));
    await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK), (error: Error) => {
      assert.ok(!(error instanceof TelegramPermanentError));
      assert.match(error.message, /algo/);
      return true;
    });
  });
});

describe('TelegramProvider: classificação de falhas do canal', () => {
  for (const [status, description] of [
    [429, 'Too Many Requests: retry after 42'],
    [500, 'Internal Server Error'],
    [401, 'Unauthorized'],
    [403, 'Forbidden: bot is not a member of the channel chat'],
    [400, 'Bad Request: need administrator rights in the channel chat'],
  ] as const) {
    test(`${status} "${description}" é falha passageira (não descarta a oferta)`, async () => {
      mockPost(() => ({ status, description }));
      await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK), (error: unknown) => {
        assert.ok(error instanceof TelegramTransientError, String(error));
        assert.ok(!(error instanceof TelegramPermanentError));
        return true;
      });
    });
  }

  test('429 repassa o retry_after da Bot API em milissegundos', async () => {
    mock.method(axios, 'post', async (url: string) => {
      const error = telegramHttpError(url, 429, 'Too Many Requests: retry after 42');
      (error.response as any).data.parameters = { retry_after: 42 };
      throw error;
    });
    await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK), (error: unknown) => {
      assert.ok(error instanceof TelegramTransientError);
      assert.equal(error.retryAfterMs, 42_000);
      return true;
    });
  });

  test('sem credenciais é falha passageira (fica aguardando a configuração)', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await assert.rejects(new TelegramProvider().sendConvertedMessage('x', LINK), TelegramTransientError);
  });

  test('link longo demais para a legenda da foto é enviado como texto', async () => {
    const calls = mockPost(() => undefined);
    const longUrl = `https://www.mercadolivre.com.br/p/MLB1?${'x'.repeat(1100)}`;
    await new TelegramProvider().sendConvertedMessage('Oferta', longUrl, Buffer.from([0xff, 0xd8, 0xff]));
    assert.deepEqual(calls.map((call) => call.method), ['sendMessage']);
    assert.ok(calls[0].body.text.endsWith(longUrl));
  });
});
