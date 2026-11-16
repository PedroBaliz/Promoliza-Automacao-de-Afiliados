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
  try {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Windows às vezes segura a pasta temporária por um instante; não é falha do teste.
  }
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

describe('pickImageSource', () => {
  const bigThumb = new Uint8Array(3 * 1024);

  test('prefere a foto anexada', () => {
    assert.equal(mod.pickImageSource({ imageMessage: { caption: 'x', fileLength: 50_000 } }), 'photo');
  });

  test('usa a prévia do link em alta qualidade quando existe', () => {
    const content = {
      extendedTextMessage: { text: 'x', thumbnailDirectPath: '/v/t62/abc', mediaKey: new Uint8Array(32), jpegThumbnail: bigThumb },
    };
    assert.equal(mod.pickImageSource(content), 'link-preview');
  });

  test('cai para a miniatura embutida e ignora miniatura pequena demais', () => {
    assert.equal(mod.pickImageSource({ extendedTextMessage: { text: 'x', jpegThumbnail: bigThumb } }), 'inline-thumbnail');
    assert.equal(mod.pickImageSource({ extendedTextMessage: { text: 'x', jpegThumbnail: new Uint8Array(500) } }), 'none');
  });

  test('texto puro não tem foto', () => {
    assert.equal(mod.pickImageSource({ conversation: 'x' }), 'none');
  });
});

describe('stripWhatsAppAsterisks', () => {
  test('tira o negrito do WhatsApp e mantém o resto do texto', () => {
    assert.equal(
      mod.stripWhatsAppAsterisks('Pré Treino 360g\nDe R$139 | Por *R$49* 💵\n*Frete grátis*'),
      'Pré Treino 360g\nDe R$139 | Por R$49 💵\nFrete grátis',
    );
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
