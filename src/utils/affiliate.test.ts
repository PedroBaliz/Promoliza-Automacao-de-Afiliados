import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAffiliateUrl, parseAffiliateTag } from './affiliate';

describe('parseAffiliateTag', () => {
  test('vazio, undefined ou só espaços resulta em none', () => {
    assert.deepEqual(parseAffiliateTag(''), { kind: 'none' });
    assert.deepEqual(parseAffiliateTag('   '), { kind: 'none' });
    assert.deepEqual(parseAffiliateTag(undefined as unknown as string), { kind: 'none' });
  });

  test('tag simples é aparada', () => {
    assert.deepEqual(parseAffiliateTag('  minhatag  '), { kind: 'tag', value: 'minhatag' });
  });

  test('formato matt:<word>:<tool> com espaços é aparado', () => {
    assert.deepEqual(parseAffiliateTag(' matt: palavra : 12345 '), { kind: 'matt', word: 'palavra', tool: '12345' });
  });

  test('matt incompleto ou com partes extras é invalid', () => {
    for (const raw of ['matt:', 'matt:palavra', 'matt:palavra:', 'matt::123', 'matt:a:b:c']) {
      assert.equal(parseAffiliateTag(raw).kind, 'invalid', raw);
    }
  });
});

describe('buildAffiliateUrl', () => {
  const original = process.env.ML_AFFILIATE_TAG;
  const sourceUrl =
    'https://produto.mercadolivre.com.br/MLB-123456-x?matt_word=outro&matt_tool=999&tag=deles&foo=bar';

  beforeEach(() => {
    delete process.env.ML_AFFILIATE_TAG;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ML_AFFILIATE_TAG;
    else process.env.ML_AFFILIATE_TAG = original;
  });

  test('sem tag configurada devolve a URL original intacta', () => {
    assert.equal(buildAffiliateUrl(sourceUrl), sourceUrl);
  });

  test('string vazia devolve string vazia', () => {
    process.env.ML_AFFILIATE_TAG = 'nossa';
    assert.equal(buildAffiliateUrl(''), '');
  });

  test('modo tag: remove afiliado da origem e aplica a nossa tag', () => {
    process.env.ML_AFFILIATE_TAG = 'nossa';
    const url = new URL(buildAffiliateUrl(sourceUrl));
    assert.equal(url.searchParams.get('tag'), 'nossa');
    assert.equal(url.searchParams.getAll('tag').length, 1);
    assert.equal(url.searchParams.has('matt_word'), false);
    assert.equal(url.searchParams.has('matt_tool'), false);
    assert.equal(url.searchParams.get('foo'), 'bar');
  });

  test('modo matt: remove afiliado da origem e aplica matt_word/matt_tool', () => {
    process.env.ML_AFFILIATE_TAG = 'matt:nossapalavra:42';
    const url = new URL(buildAffiliateUrl(sourceUrl));
    assert.equal(url.searchParams.get('matt_word'), 'nossapalavra');
    assert.equal(url.searchParams.get('matt_tool'), '42');
    assert.equal(url.searchParams.getAll('matt_word').length, 1);
    assert.equal(url.searchParams.has('tag'), false);
    assert.equal(url.searchParams.get('foo'), 'bar');
  });

  test('modo invalid: ainda remove o afiliado da origem e não aplica nada', () => {
    process.env.ML_AFFILIATE_TAG = 'matt:incompleto';
    const url = new URL(buildAffiliateUrl(sourceUrl));
    assert.equal(url.searchParams.has('matt_word'), false);
    assert.equal(url.searchParams.has('matt_tool'), false);
    assert.equal(url.searchParams.has('tag'), false);
    assert.equal(url.searchParams.get('foo'), 'bar');
  });

  test('URL inválida com tag configurada devolve a original', (t) => {
    t.mock.method(console, 'error', () => {});
    process.env.ML_AFFILIATE_TAG = 'nossa';
    assert.equal(buildAffiliateUrl('não é url'), 'não é url');
  });
});
