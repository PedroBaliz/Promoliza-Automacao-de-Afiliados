import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// O módulo importa env.config (dotenv + process.cwd()): troca o cwd para um diretório
// temporário vazio antes do import para não ler o .env real do projeto.
const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promoliza-source-'));
let mod: typeof import('./telegram-source.service');

before(async () => {
  process.chdir(tempDir);
  mod = await import('./telegram-source.service');
});

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function urlEntity(text: string, fragment: string) {
  const offset = text.indexOf(fragment);
  assert.ok(offset >= 0, `fragmento ausente: ${fragment}`);
  return { className: 'MessageEntityUrl', offset, length: fragment.length };
}

describe('collectMessageUrls', () => {
  test('pega URLs com esquema do texto', () => {
    const urls = mod.collectMessageUrls({ message: 'Oferta https://meli.la/abc!' });
    assert.deepEqual(urls, ['https://meli.la/abc']);
  });

  test('MessageEntityUrl sem esquema ganha https://', () => {
    const text = '🔥 Promo meli.la/xyz123 corre';
    const urls = mod.collectMessageUrls({ message: text, entities: [urlEntity(text, 'meli.la/xyz123')] });
    assert.deepEqual(urls, ['https://meli.la/xyz123']);
  });

  test('offsets de entidade em UTF-16 funcionam depois de emojis', () => {
    const text = '😀😀😀 link: meli.la/emoji';
    const urls = mod.collectMessageUrls({ message: text, entities: [urlEntity(text, 'meli.la/emoji')] });
    assert.deepEqual(urls, ['https://meli.la/emoji']);
  });

  test('MessageEntityTextUrl (texto com hyperlink) usa entity.url', () => {
    const urls = mod.collectMessageUrls({
      message: 'Compre aqui',
      entities: [{ className: 'MessageEntityTextUrl', offset: 0, length: 11, url: 'https://meli.la/hidden' }],
    });
    assert.deepEqual(urls, ['https://meli.la/hidden']);
  });

  test('inclui URLs de botões inline', () => {
    const urls = mod.collectMessageUrls({
      message: 'Oferta',
      buttons: [[{ url: 'https://meli.la/btn' }, { text: 'sem url' }]],
    });
    assert.deepEqual(urls, ['https://meli.la/btn']);
  });

  test('não duplica URL presente no texto e na entidade', () => {
    const text = 'veja https://meli.la/dup';
    const urls = mod.collectMessageUrls({ message: text, entities: [urlEntity(text, 'https://meli.la/dup')] });
    assert.deepEqual(urls, ['https://meli.la/dup']);
  });

  test('mensagem sem texto nem entidades retorna vazio', () => {
    assert.deepEqual(mod.collectMessageUrls({}), []);
  });
});

// Linhas removidas podem deixar uma linha em branco (o código limita a no máximo uma);
// aqui só importa que o conteúdo restante seja preservado, na ordem.
function compact(text: string): string {
  assert.ok(!/\n{3,}/.test(text), `mais de uma linha em branco seguida: ${JSON.stringify(text)}`);
  return text.replace(/\n{2}/g, '\n');
}

describe('removeLinksFromSourceText', () => {
  test('remove URL com esquema e preserva o resto', () => {
    const result = mod.removeLinksFromSourceText('Fone Bluetooth por R$ 99,90\nhttps://meli.la/abc\nCupom: PROMO10');
    assert.equal(compact(result), 'Fone Bluetooth por R$ 99,90\nCupom: PROMO10');
  });

  test('remove link sem esquema marcado por MessageEntityUrl', () => {
    const text = 'Air Fryer R$ 299\nmeli.la/xyz\nFrete grátis';
    const result = mod.removeLinksFromSourceText(text, [urlEntity(text, 'meli.la/xyz')]);
    assert.equal(compact(result), 'Air Fryer R$ 299\nFrete grátis');
  });

  test('remove link sem esquema mesmo sem entidade (meli.la, www, mercadolivre)', () => {
    const result = mod.removeLinksFromSourceText(
      'Produto A\nmeli.la/abc\nwww.exemplo.com/x\nproduto.mercadolivre.com.br/MLB-123-x\nFim',
    );
    assert.equal(compact(result), 'Produto A\nFim');
  });

  test('remove links do t.me (com e sem esquema) e de WhatsApp', () => {
    const result = mod.removeLinksFromSourceText(
      'Oferta X\nEntre no grupo: t.me/grupoconcorrente\nhttps://t.me/+abcDEF\nchat.whatsapp.com/ABC123\nValeu',
    );
    assert.ok(!/t\.me|whatsapp/i.test(result), result);
    assert.ok(result.startsWith('Oferta X'));
    assert.ok(result.endsWith('Valeu'));
  });

  test('não remove e-mail nem texto com ponto que não é link', () => {
    const result = mod.removeLinksFromSourceText('Contato: loja@t.me.com.br\nPreço 1.299,00');
    assert.equal(result, 'Contato: loja@t.me.com.br\nPreço 1.299,00');
  });

  test('remove rótulos órfãos "🔗 Link:" e "👉 Compre aqui"', () => {
    const result = mod.removeLinksFromSourceText(
      'Smart TV 50" por R$ 1.999\n🔗 Link: https://meli.la/tv\n👉 Compre aqui\nhttps://meli.la/tv2\nParcelado em 10x',
    );
    assert.equal(compact(result), 'Smart TV 50" por R$ 1.999\nParcelado em 10x');
  });

  test('remove outros rótulos órfãos comuns', () => {
    for (const label of ['Link da oferta:', '➡️ Comprar', 'Acesse aqui:', '👉 Clique aqui 👈', 'LINK DO PRODUTO']) {
      const result = mod.removeLinksFromSourceText(`Produto\n${label} https://meli.la/x\nFim`);
      assert.equal(compact(result), 'Produto\nFim', label);
    }
  });

  test('não apaga linhas que apenas contêm a palavra link no meio de texto', () => {
    const text = 'Comprei pelo link e chegou rápido\nCompre aqui com desconto de 20%';
    assert.equal(mod.removeLinksFromSourceText(text), text);
  });

  test('link em markdown mantém só o rótulo', () => {
    assert.equal(mod.removeLinksFromSourceText('Veja [o produto](https://meli.la/x) hoje'), 'Veja o produto hoje');
  });

  test('colapsa espaços e linhas em branco excedentes', () => {
    const result = mod.removeLinksFromSourceText('Linha 1   https://meli.la/a   fim\n\n\n\n\nLinha 2');
    assert.equal(result, 'Linha 1 fim\n\nLinha 2');
  });

  test('texto só com link vira string vazia', () => {
    assert.equal(mod.removeLinksFromSourceText('https://meli.la/abc'), '');
  });
});
