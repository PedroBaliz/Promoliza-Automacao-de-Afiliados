import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AxiosError, AxiosHeaders } from 'axios';
import { describeError, redactSecrets } from './errors';

const TOKEN = '123456789:AAFakeTokenForTests_abcdefghijklmno';
const API_URL = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

function axiosError(status?: number, data?: unknown, message = 'Request failed'): AxiosError {
  const config = { url: API_URL, headers: new AxiosHeaders() } as any;
  const response = status
    ? ({ status, statusText: '', data, headers: {}, config } as any)
    : undefined;
  return new AxiosError(message, status ? 'ERR_BAD_REQUEST' : 'ECONNRESET', config, {}, response);
}

describe('redactSecrets', () => {
  test('mascara token de bot em URL', () => {
    const result = redactSecrets(`falha em ${API_URL}`);
    assert.ok(!result.includes(TOKEN));
    assert.ok(!result.includes('AAFakeToken'));
    assert.ok(result.includes('bot***'));
  });

  test('mascara vários tokens', () => {
    const result = redactSecrets(`${API_URL} e ${API_URL}`);
    assert.ok(!result.includes('AAFakeToken'));
  });

  test('texto sem token fica igual', () => {
    assert.equal(redactSecrets('erro comum sem segredo'), 'erro comum sem segredo');
  });
});

describe('describeError', () => {
  test('AxiosError com resposta usa status e description, sem a URL/token', () => {
    const result = describeError(axiosError(400, { description: 'Bad Request: chat not found' }));
    assert.equal(result, 'HTTP 400: Bad Request: chat not found');
    assert.ok(!result.includes('AAFakeToken'));
  });

  test('AxiosError sem resposta usa o código', () => {
    const result = describeError(axiosError());
    assert.equal(result, 'ECONNRESET');
  });

  test('AxiosError cuja mensagem contém a URL com token é mascarado', () => {
    const error = axiosError(undefined, undefined, `connect failed ${API_URL}`);
    error.code = undefined;
    const result = describeError(error);
    assert.ok(!result.includes('AAFakeToken'), result);
  });

  test('description contendo o token é mascarada', () => {
    const result = describeError(axiosError(500, { description: `erro em ${API_URL}` }));
    assert.ok(!result.includes('AAFakeToken'), result);
  });

  test('Error comum com token na mensagem é mascarado', () => {
    const result = describeError(new TypeError(`fetch failed: ${API_URL}`));
    assert.ok(result.startsWith('TypeError: fetch failed'));
    assert.ok(!result.includes('AAFakeToken'), result);
  });

  test('valor não-Error é convertido para string e mascarado', () => {
    assert.equal(describeError('falhou'), 'falhou');
    assert.ok(!describeError(API_URL).includes('AAFakeToken'));
  });
});
