import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mesmo cuidado do teste do Telegram: não ler o .env real do projeto.
const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promoliza-wa-source-'));
let mod: typeof import('./whatsapp-source.service');

before(async () => {
  process.chdir(tempDir);
  mod = await import('./whatsapp-source.service');
});

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('extractWhatsAppText', () => {
  test('lê texto simples, texto com prévia e legenda de foto', () => {
    assert.equal(mod.extractWhatsAppText({ conversation: 'oi' }), 'oi');
    assert.equal(mod.extractWhatsAppText({ extendedTextMessage: { text: 'oferta' } }), 'oferta');
    assert.equal(mod.extractWhatsAppText({ imageMessage: { caption: 'legenda' } }), 'legenda');
  });

  test('desembrulha mensagens temporárias e de visualização única', () => {
    const content = { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: { caption: 'x' } } } } } };
    assert.equal(mod.extractWhatsAppText(content), 'x');
  });

  test('mensagem sem texto devolve string vazia', () => {
    assert.equal(mod.extractWhatsAppText(undefined), '');
    assert.equal(mod.extractWhatsAppText({ reactionMessage: { text: '👍' } }), '');
  });
});

describe('collectWhatsAppUrls', () => {
  test('pega links com esquema, sem esquema e da prévia, sem repetir', () => {
    const content = {
      extendedTextMessage: {
        text: '🔥 Fone 99,90\nhttps://mercadolivre.com/sec/abc.\nOutro: meli.la/xyz',
        matchedText: 'https://mercadolivre.com/sec/abc',
      },
    };
    assert.deepEqual(mod.collectWhatsAppUrls(content), [
      'https://mercadolivre.com/sec/abc',
      'https://meli.la/xyz',
    ]);
  });

  test('mensagem sem link devolve lista vazia', () => {
    assert.deepEqual(mod.collectWhatsAppUrls({ conversation: 'bom dia grupo' }), []);
  });
});
