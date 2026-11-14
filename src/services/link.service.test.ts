import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import {
  buildDedupKey,
  extractSocialProductUrl,
  extractUrls,
  isMercadoLivreHost,
  resolveMercadoLivreLink,
  shortenUrl,
} from './link.service';

type FakeResponse = { status: number; location?: string };

/** Mocka axios.get com uma resposta por URL; URLs não mapeadas falham o teste. */
function mockGet(routes: Record<string, FakeResponse>) {
  return mock.method(axios, 'get', async (url: string) => {
    const route = routes[url];
    if (!route) throw new Error(`requisição inesperada: ${url}`);
    return { status: route.status, headers: route.location ? { location: route.location } : {}, data: undefined };
  });
}

const originalTag = process.env.ML_AFFILIATE_TAG;

beforeEach(() => {
  process.env.ML_AFFILIATE_TAG = 'nossatag';
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  mock.restoreAll();
  if (originalTag === undefined) delete process.env.ML_AFFILIATE_TAG;
  else process.env.ML_AFFILIATE_TAG = originalTag;
});

describe('extractUrls', () => {
  test('extrai http e https do texto', () => {
    assert.deepEqual(extractUrls('veja https://a.com/x e http://b.com/y'), ['https://a.com/x', 'http://b.com/y']);
  });

  test('remove pontuação final e deduplica depois de limpar', () => {
    assert.deepEqual(extractUrls('https://a.com/x. de novo https://a.com/x!'), ['https://a.com/x']);
  });

  test('não inclui emoji, "…" ou "»" grudados no link', () => {
    assert.deepEqual(extractUrls('👉https://meli.la/abc🔥 e https://meli.la/def… »https://meli.la/ghi»'), [
      'https://meli.la/abc',
      'https://meli.la/def',
      'https://meli.la/ghi',
    ]);
  });

  test('preserva query string', () => {
    assert.deepEqual(extractUrls('https://a.com/p?x=1&y=2'), ['https://a.com/p?x=1&y=2']);
  });

  test('texto sem link ou vazio retorna lista vazia', () => {
    assert.deepEqual(extractUrls('sem link aqui meli.la/abc'), []);
    assert.deepEqual(extractUrls(''), []);
  });
});

describe('isMercadoLivreHost', () => {
  test('aceita hosts do ML, com www, maiúsculas e ponto final', () => {
    for (const host of [
      'mercadolivre.com.br',
      'www.mercadolivre.com.br',
      'MERCADOLIVRE.COM.BR',
      'mercadolivre.com.br.',
      'produto.mercadolivre.com.br',
      'lista.mercadolivre.com.br',
      'articulo.mercadolibre.com',
      'meli.la',
    ]) {
      assert.equal(isMercadoLivreHost(host), true, host);
    }
  });

  test('recusa hosts parecidos ou de terceiros', () => {
    for (const host of [
      'mercadolivre.com.br.evil.com',
      'evilmercadolivre.com.br',
      'fakemeli.la',
      'meli.la.evil.com',
      'bit.ly',
      'localhost',
      '169.254.169.254',
    ]) {
      assert.equal(isMercadoLivreHost(host), false, host);
    }
  });
});

describe('buildDedupKey', () => {
  test('usa o ID MLB com ou sem hífen', () => {
    assert.equal(buildDedupKey(new URL('https://produto.mercadolivre.com.br/MLB-1234567-celular')), 'ml:MLB1234567');
    assert.equal(buildDedupKey(new URL('https://www.mercadolivre.com.br/celular/p/MLB1234567')), 'ml:MLB1234567');
  });

  test('mesmo produto por caminhos diferentes gera a mesma chave', () => {
    const a = buildDedupKey(new URL('https://produto.mercadolivre.com.br/MLB-1234567-x?matt_word=a'));
    const b = buildDedupKey(new URL('https://www.mercadolivre.com.br/y/p/mlb1234567?tag=b'));
    assert.equal(a, b);
  });

  test('sem MLB usa host normalizado + caminho sem barra final, ignorando parâmetros de rastreio', () => {
    assert.equal(
      buildDedupKey(new URL('https://WWW.mercadolivre.com.br/Ofertas/Dia/?utm_source=x&matt_word=y&tag=z')),
      'ml:url:mercadolivre.com.br/ofertas/dia',
    );
  });

  test('sem MLB, a query distingue ofertas diferentes na mesma página (ordem não importa)', () => {
    const a = buildDedupKey(new URL('https://www.mercadolivre.com.br/ofertas?promotion_id=1&container=2'));
    const b = buildDedupKey(new URL('https://www.mercadolivre.com.br/ofertas?container=2&promotion_id=1&utm_medium=t'));
    const c = buildDedupKey(new URL('https://www.mercadolivre.com.br/ofertas?promotion_id=9&container=2'));
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

describe('resolveMercadoLivreLink: afiliado da origem', () => {
  test('meli.la que não redireciona (403 de robô) é recusado para não manter o afiliado da origem', async () => {
    mockGet({ 'https://meli.la/abc': { status: 403 } });
    assert.equal(await resolveMercadoLivreLink('https://meli.la/abc'), null);
  });

  test('página /social/ sem produto identificável é recusada', async () => {
    mockGet({
      'https://meli.la/abc': { status: 301, location: 'https://www.mercadolivre.com.br/social/outroafiliado?ref=x' },
      'https://www.mercadolivre.com.br/social/outroafiliado?ref=x': { status: 200 },
    });
    assert.equal(await resolveMercadoLivreLink('https://meli.la/abc'), null);
  });

  test('página /social/ de outro afiliado vira o link do produto com a nossa tag', async () => {
    const social = 'https://www.mercadolivre.com.br/social/outroafiliado?matt_word=OUTRO&matt_tool=1&ref=xyz';
    mock.method(axios, 'get', async (url: string, options: any) => {
      if (url === 'https://meli.la/abc') return { status: 301, headers: { location: social }, data: undefined };
      if (url === social && options?.responseType === 'stream') return { status: 200, headers: {}, data: undefined };
      if (url === social) return { status: 200, headers: {}, data: SOCIAL_PAGE_HTML };
      throw new Error(`requisição inesperada: ${url}`);
    });

    const deal = await resolveMercadoLivreLink('https://meli.la/abc');
    assert.ok(deal);
    const affiliate = new URL(deal.affiliateUrl);
    assert.equal(affiliate.pathname, '/body-spray-212-vip-black-250-ml/p/MLB24059210');
    assert.equal(affiliate.searchParams.get('tag'), 'nossatag');
    assert.equal(affiliate.searchParams.get('matt_word'), null);
    assert.equal(deal.dedupKey, 'ml:MLB24059210');
  });

  test('403 num domínio de produto do ML continua aceito', async () => {
    mockGet({ 'https://produto.mercadolivre.com.br/MLB-123456-x': { status: 403 } });
    const deal = await resolveMercadoLivreLink('https://produto.mercadolivre.com.br/MLB-123456-x');
    assert.equal(deal?.dedupKey, 'ml:MLB123456');
  });
});

describe('resolveMercadoLivreLink', () => {
  test('link direto do ML 200 retorna finalUrl, affiliateUrl com nossa tag e dedupKey', async () => {
    const url = 'https://produto.mercadolivre.com.br/MLB-1234567-x?tag=deles';
    const get = mockGet({ [url]: { status: 200 } });
    const deal = await resolveMercadoLivreLink(url);
    assert.ok(deal);
    assert.equal(deal.finalUrl, url);
    assert.equal(new URL(deal.affiliateUrl).searchParams.get('tag'), 'nossatag');
    assert.equal(deal.dedupKey, 'ml:MLB1234567');
    assert.equal(get.mock.callCount(), 1);
    const options = get.mock.calls[0].arguments[1] as any;
    assert.equal(options.maxRedirects, 0);
  });

  test('segue redirecionamento manual (3xx + location) de encurtador para o ML', async () => {
    const get = mockGet({
      'https://meli.la/abc': { status: 301, location: 'https://bit.ly/xyz' },
      'https://bit.ly/xyz': { status: 302, location: 'https://produto.mercadolivre.com.br/MLB-7654321-y?matt_word=deles' },
      'https://produto.mercadolivre.com.br/MLB-7654321-y?matt_word=deles': { status: 200 },
    });
    const deal = await resolveMercadoLivreLink('https://meli.la/abc');
    assert.ok(deal);
    assert.equal(deal.dedupKey, 'ml:MLB7654321');
    const affiliate = new URL(deal.affiliateUrl);
    assert.equal(affiliate.searchParams.get('tag'), 'nossatag');
    assert.equal(affiliate.searchParams.has('matt_word'), false);
    assert.equal(get.mock.callCount(), 3);
  });

  test('location relativa que resolve para o encurtador não vira link do ML', async () => {
    mockGet({
      'https://bit.ly/xyz': { status: 302, location: '/MLB-7654321-y' },
      'https://bit.ly/MLB-7654321-y': { status: 200 },
    });
    assert.equal(await resolveMercadoLivreLink('https://bit.ly/xyz'), null);
  });

  test('redirecionamento com location relativa dentro do ML é resolvido', async () => {
    mockGet({
      'https://meli.la/abc': { status: 302, location: 'https://www.mercadolivre.com.br/sec/abc' },
      'https://www.mercadolivre.com.br/sec/abc': { status: 302, location: '/p/MLB999888777' },
      'https://www.mercadolivre.com.br/p/MLB999888777': { status: 200 },
    });
    const deal = await resolveMercadoLivreLink('https://meli.la/abc');
    assert.ok(deal);
    assert.equal(deal.finalUrl, 'https://www.mercadolivre.com.br/p/MLB999888777');
    assert.equal(deal.dedupKey, 'ml:MLB999888777');
  });

  test('hosts não permitidos são recusados sem nenhuma requisição', async () => {
    const get = mockGet({});
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/health',
      'http://127.0.0.1/',
      'http://2852039166/',
      'https://user:pw@mercadolivre.com.br/MLB-1234567',
      'https://mercadolivre.com.br@evil.com/MLB-1234567',
      'ftp://mercadolivre.com.br/MLB-1234567',
      'file:///etc/passwd',
      'https://example.com/MLB-1234567',
      'não é url',
    ]) {
      assert.equal(await resolveMercadoLivreLink(url), null, url);
    }
    assert.equal(get.mock.callCount(), 0);
  });

  test('redirect para host interno é bloqueado antes de requisitar', async () => {
    const get = mockGet({
      'https://bit.ly/x': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
    });
    assert.equal(await resolveMercadoLivreLink('https://bit.ly/x'), null);
    assert.equal(get.mock.callCount(), 1);
  });

  test('redirect para localhost e para credenciais na URL é bloqueado', async () => {
    const get = mockGet({
      'https://bit.ly/a': { status: 302, location: 'http://localhost/admin' },
      'https://bit.ly/b': { status: 307, location: 'https://u:p@mercadolivre.com.br/x' },
    });
    assert.equal(await resolveMercadoLivreLink('https://bit.ly/a'), null);
    assert.equal(await resolveMercadoLivreLink('https://bit.ly/b'), null);
    assert.equal(get.mock.callCount(), 2);
  });

  test('403 e 429 em host do ML são aceitos (bloqueio de robô)', async () => {
    for (const status of [403, 429]) {
      const url = `https://produto.mercadolivre.com.br/MLB-11111${status}-x`;
      mockGet({ [url]: { status } });
      const deal = await resolveMercadoLivreLink(url);
      assert.ok(deal, String(status));
      mock.restoreAll();
      mock.method(console, 'log', () => {});
    }
  });

  test('403 em encurtador (destino fora do ML) é recusado', async () => {
    mockGet({ 'https://bit.ly/x': { status: 403 } });
    assert.equal(await resolveMercadoLivreLink('https://bit.ly/x'), null);
  });

  test('404 e 500 no ML são recusados', async () => {
    mockGet({
      'https://www.mercadolivre.com.br/p/MLB1234567': { status: 404 },
      'https://www.mercadolivre.com.br/p/MLB7654321': { status: 500 },
    });
    assert.equal(await resolveMercadoLivreLink('https://www.mercadolivre.com.br/p/MLB1234567'), null);
    assert.equal(await resolveMercadoLivreLink('https://www.mercadolivre.com.br/p/MLB7654321'), null);
  });

  test('200 em encurtador sem chegar ao ML é recusado', async () => {
    mockGet({ 'https://bit.ly/x': { status: 200 } });
    assert.equal(await resolveMercadoLivreLink('https://bit.ly/x'), null);
  });

  test('3xx sem location é tratado como resposta final (recusado)', async () => {
    mockGet({ 'https://www.mercadolivre.com.br/p/MLB1234567': { status: 302 } });
    assert.equal(await resolveMercadoLivreLink('https://www.mercadolivre.com.br/p/MLB1234567'), null);
  });

  test('exatamente 5 redirects ainda resolve', async () => {
    const routes: Record<string, FakeResponse> = {};
    for (let i = 0; i < 5; i++) routes[`https://bit.ly/h${i}`] = { status: 302, location: `https://bit.ly/h${i + 1}` };
    routes['https://bit.ly/h4'] = { status: 302, location: 'https://www.mercadolivre.com.br/p/MLB1234567' };
    delete routes['https://bit.ly/h5'];
    routes['https://www.mercadolivre.com.br/p/MLB1234567'] = { status: 200 };
    const get = mockGet(routes);
    assert.ok(await resolveMercadoLivreLink('https://bit.ly/h0'));
    assert.equal(get.mock.callCount(), 6);
  });

  test('mais de 5 redirects retorna null', async () => {
    const routes: Record<string, FakeResponse> = {};
    for (let i = 0; i < 10; i++) routes[`https://bit.ly/h${i}`] = { status: 302, location: `https://bit.ly/h${i + 1}` };
    const get = mockGet(routes);
    assert.equal(await resolveMercadoLivreLink('https://bit.ly/h0'), null);
    assert.equal(get.mock.callCount(), 6);
  });

  test('erro de rede retorna null', async () => {
    mock.method(axios, 'get', async () => {
      throw new Error('ECONNRESET');
    });
    assert.equal(await resolveMercadoLivreLink('https://meli.la/abc'), null);
  });

  test('destrói o stream da resposta', async () => {
    let destroyed = false;
    mock.method(axios, 'get', async () => ({
      status: 200,
      headers: {},
      data: { destroy: () => (destroyed = true) },
    }));
    await resolveMercadoLivreLink('https://www.mercadolivre.com.br/p/MLB1234567');
    assert.equal(destroyed, true);
  });
});

describe('shortenUrl', () => {
  test('retorna o link curto do is.gd e envia a URL como parâmetro', async () => {
    const get = mock.method(axios, 'get', async () => ({ status: 200, data: 'https://is.gd/AbC123\n' }));
    assert.equal(await shortenUrl('https://www.mercadolivre.com.br/p/MLB1?tag=x'), 'https://is.gd/AbC123');
    const [url, options] = get.mock.calls[0].arguments as any[];
    assert.equal(url, 'https://is.gd/create.php');
    assert.equal(options.params.url, 'https://www.mercadolivre.com.br/p/MLB1?tag=x');
  });

  test('resposta inválida devolve o link original', async () => {
    mock.method(axios, 'get', async () => ({ status: 200, data: 'Error: rate limited' }));
    assert.equal(await shortenUrl('https://ml.com/x'), 'https://ml.com/x');
  });

  test('resposta apontando para outro domínio devolve o link original', async () => {
    mock.method(axios, 'get', async () => ({ status: 200, data: 'https://evil.com/abc' }));
    assert.equal(await shortenUrl('https://ml.com/x'), 'https://ml.com/x');
  });

  test('erro de rede devolve o link original', async () => {
    mock.method(axios, 'get', async () => {
      throw new Error('timeout');
    });
    assert.equal(await shortenUrl('https://ml.com/x'), 'https://ml.com/x');
  });
});

// Trecho reduzido de uma página /social/ real: o produto principal é o "gatilho" das
// recomendações; os outros itens são recomendados e não podem ser escolhidos.
const SOCIAL_PAGE_HTML = [
  '<meta property="og:title" content="Body Spray 212 VIP Black 250 ml - R$ 165">',
  '<script>{"items":[{"permalink":"https:\u002F\u002Fwww.mercadolivre.com.br\u002Foutro-perfume\u002Fp\u002FMLB27838890?matt_event_ts=1"},',
  '{"permalink":"https:\/\/www.mercadolivre.com.br\/body-spray-212-vip-black-250-ml\/p\/MLB24059210?matt_event_ts=1&matt_d2id=x"}],',
  '"trigger":{"trigger_type":"product","item_info":{"id":"MLB24059210"},"product_info":{"id":"MLB24059210"}}}</script>',
].join('\n');

describe('extractSocialProductUrl', () => {
  test('escolhe o produto do gatilho, não um recomendado, e remove a query', () => {
    assert.equal(
      extractSocialProductUrl(SOCIAL_PAGE_HTML),
      'https://www.mercadolivre.com.br/body-spray-212-vip-black-250-ml/p/MLB24059210',
    );
  });

  test('sem gatilho de produto retorna null', () => {
    assert.equal(extractSocialProductUrl('<html>sem dados</html>'), null);
  });

  test('não confunde IDs com prefixo igual (MLB240 ≠ MLB2405)', () => {
    const html =
      '"https://www.mercadolivre.com.br/x/p/MLB2405" "trigger":{"trigger_type":"product","item_info":{"id":"MLB240"}}';
    assert.equal(extractSocialProductUrl(html), null);
  });
});
