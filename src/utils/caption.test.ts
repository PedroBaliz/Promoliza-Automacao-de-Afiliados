import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaption, TELEGRAM_CAPTION_LIMIT, TELEGRAM_TEXT_LIMIT } from './caption';

const LINK = 'https://is.gd/abc123';
const SUFFIX = `🛒 Acessar oferta: ${LINK}`;

describe('buildCaption', () => {
  test('texto curto fica inteiro, com separador e link no fim', () => {
    assert.equal(buildCaption('Oferta boa', LINK, TELEGRAM_CAPTION_LIMIT), `Oferta boa\n\n${SUFFIX}`);
  });

  test('caption vazia gera só o sufixo, sem separador', () => {
    assert.equal(buildCaption('', LINK, TELEGRAM_CAPTION_LIMIT), SUFFIX);
  });

  test('texto longo é cortado com "…" e respeita o limite', () => {
    for (const limit of [TELEGRAM_CAPTION_LIMIT, TELEGRAM_TEXT_LIMIT, 100]) {
      const result = buildCaption('a'.repeat(limit * 2), LINK, limit);
      assert.ok(result.length <= limit, `limite ${limit}: ${result.length}`);
      assert.ok(result.endsWith(`…\n\n${SUFFIX}`));
    }
  });

  test('texto exatamente no limite não é cortado', () => {
    const limit = 200;
    const room = limit - SUFFIX.length - 2;
    const text = 'b'.repeat(room);
    const result = buildCaption(text, LINK, limit);
    assert.equal(result.length, limit);
    assert.ok(!result.includes('…'));
  });

  test('link de afiliado fica inteiro no fim mesmo com corte', () => {
    const longLink = `https://produto.mercadolivre.com.br/MLB-123?matt_word=x&matt_tool=${'9'.repeat(200)}`;
    const result = buildCaption('x'.repeat(5000), longLink, TELEGRAM_CAPTION_LIMIT);
    assert.ok(result.endsWith(longLink));
    assert.ok(result.length <= TELEGRAM_CAPTION_LIMIT);
  });

  test('não deixa surrogate pair partido no ponto de corte', () => {
    const limit = 100;
    const room = limit - SUFFIX.length - 2;
    // Posiciona um emoji (2 unidades UTF-16) exatamente onde cairia o corte (room - 1).
    for (const shift of [0, 1, 2]) {
      const text = 'c'.repeat(room - 2 - shift) + '😀'.repeat(20);
      const result = buildCaption(text, LINK, limit);
      assert.ok(result.length <= limit);
      const body = result.slice(0, result.indexOf('…'));
      assert.ok(!/[\uD800-\uDBFF]$/.test(body), `surrogate alto solto (shift ${shift})`);
      assert.ok(!/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(body), `surrogate baixo solto (shift ${shift})`);
    }
  });

  test('espaços no ponto de corte são removidos antes do "…"', () => {
    const limit = 100;
    const room = limit - SUFFIX.length - 2;
    const text = 'd'.repeat(room - 5) + '          ' + 'e'.repeat(50);
    const result = buildCaption(text, LINK, limit);
    assert.ok(result.includes('d…'));
  });
});

describe('buildCaption: link maior que o limite', () => {
  test('devolve só o link inteiro (quem chama envia como texto)', () => {
    const longUrl = `https://www.mercadolivre.com.br/p/MLB1?${'x'.repeat(1100)}`;
    const result = buildCaption('Oferta', longUrl, TELEGRAM_CAPTION_LIMIT);
    assert.equal(result, `🛒 Acessar oferta: ${longUrl}`);
  });
});
