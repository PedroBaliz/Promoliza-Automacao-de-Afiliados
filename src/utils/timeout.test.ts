import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, withTimeout } from './timeout';

describe('withTimeout', () => {
  test('resolve com o valor da promise quando ela termina antes', async () => {
    assert.equal(await withTimeout(Promise.resolve(42), 1000, 'rapida'), 42);
  });

  test('rejeita com mensagem contendo o rótulo quando estoura o tempo', async () => {
    const never = new Promise<never>(() => {});
    await assert.rejects(withTimeout(never, 20, '[Teste] lenta'), /\[Teste\] lenta: tempo limite de 20 ms excedido/);
  });

  test('propaga a rejeição original da promise', async () => {
    await assert.rejects(withTimeout(Promise.reject(new Error('original')), 1000, 'x'), /original/);
  });

  test('não deixa o timer pendurado depois de resolver', async () => {
    // Se o timer de 60s não fosse limpo, o processo de teste ficaria preso até ele disparar.
    assert.equal(await withTimeout(sleep(5).then(() => 'ok'), 60_000, 'x'), 'ok');
  });
});
