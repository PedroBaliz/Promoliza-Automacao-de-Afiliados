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
  try {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Windows às vezes segura a pasta temporária por um instante; não é falha do teste.
  }
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

describe('renderSourceCaption: link de afiliado no lugar do original', () => {
  const SLOT = '⟦LINK⟧';

  test('o link da oferta vira o marcador na mesma linha do original', () => {
    const text = 'Cadeira NR17\n🤑 Por: R$ 319\n\n🛒 Compre aqui: https://meli.la/26PnKf4\n\n⏳ oferta';
    const entities = [urlEntity(text, 'https://meli.la/26PnKf4')];
    const template = mod.tokenizeLinks(text, entities);
    assert.equal(
      mod.renderSourceCaption(template, 'https://meli.la/26PnKf4'),
      `Cadeira NR17\n🤑 Por: R$ 319\n\n🛒 Compre aqui: ${SLOT}\n\n⏳ oferta`,
    );
  });

  test('mantém o 👉 quando o link continua na linha (com e sem https)', () => {
    const a = mod.tokenizeLinks('Perfume\n🛒 Achado no Mercado Livre 👉 https://meli.la/abc');
    assert.equal(mod.renderSourceCaption(a, 'https://meli.la/abc'), `Perfume\n🛒 Achado no Mercado Livre 👉 ${SLOT}`);
    const b = mod.tokenizeLinks('Kit\n👉 meli.la/xyz');
    assert.equal(mod.renderSourceCaption(b, 'https://meli.la/xyz'), `Kit\n👉 ${SLOT}`);
  });

  test('com dois links, cada oferta mostra só o seu e a linha do outro sai', () => {
    const text = 'Camiseta\n\nPreto: https://meli.la/AAA\nVerde: https://meli.la/BBB\n\n⏳ oferta';
    const entities = [urlEntity(text, 'https://meli.la/AAA'), urlEntity(text, 'https://meli.la/BBB')];
    const template = mod.tokenizeLinks(text, entities);
    assert.equal(mod.renderSourceCaption(template, 'https://meli.la/AAA'), `Camiseta\n\nPreto: ${SLOT}\n\n⏳ oferta`);
    assert.equal(mod.renderSourceCaption(template, 'https://meli.la/BBB'), `Camiseta\n\nVerde: ${SLOT}\n\n⏳ oferta`);
  });

  test('link que não aparece no texto (botão, link escondido) não gera marcador', () => {
    const template = mod.tokenizeLinks('Fone por R$ 99\nhttps://meli.la/visivel');
    assert.equal(mod.renderSourceCaption(template, 'https://meli.la/botao'), 'Fone por R$ 99');
  });
});

describe('removeLinksFromSourceText: emoji que apontava para o link', () => {
  test('tira o 👉 que fica no fim da linha sem o link', () => {
    const text = 'Perfume 100ml\nDe R$819 | Por R$499 💵\n\n🛒 Achado no Mercado Livre 👉 https://meli.la/1kH7RME';
    assert.equal(mod.removeLinksFromSourceText(text), 'Perfume 100ml\nDe R$819 | Por R$499 💵\n\n🛒 Achado no Mercado Livre');
  });

  test('tira a linha que sobra só com emoji', () => {
    const text = 'Perfume 100ml\n🛒 Achado no Mercado Livre\n👉🏻\nhttps://meli.la/1kH7RME';
    assert.equal(mod.removeLinksFromSourceText(text), 'Perfume 100ml\n🛒 Achado no Mercado Livre');
  });

  test('mantém emoji que não aponta para link e linhas com texto', () => {
    const text = 'Body Spray 250ml 🔥\nPor R$165 💵\n👉 Cupom: BLACK30\nhttps://meli.la/x';
    assert.equal(mod.removeLinksFromSourceText(text), 'Body Spray 250ml 🔥\nPor R$165 💵\n👉 Cupom: BLACK30');
  });
});

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
