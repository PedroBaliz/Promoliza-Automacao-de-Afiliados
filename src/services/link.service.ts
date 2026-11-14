import axios from 'axios';
import { buildAffiliateUrl } from '../utils/affiliate';
import { describeError } from '../utils/errors';

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const MERCADO_LIVRE_HOSTS = new Set([
  'mercadolivre.com.br',
  'mercadolivre.com',
  'produto.mercadolivre.com.br',
  'mercadolibre.com',
  'meli.la',
]);

// Encurtadores que grupos de ofertas costumam usar por cima do link do ML.
// Só esses hosts (e os do ML) são acessados: qualquer outro é descartado antes de
// qualquer requisição, para o bot não ser usado para acessar endereços internos (SSRF).
const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  'is.gd',
  'cutt.ly',
  'shorturl.at',
  'encurtador.com.br',
  'abre.ai',
  'rebrand.ly',
  'ow.ly',
  'tiny.cc',
  't.co',
]);

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

export function isMercadoLivreHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return (
    MERCADO_LIVRE_HOSTS.has(host) ||
    host.endsWith('.mercadolivre.com.br') ||
    host.endsWith('.mercadolivre.com') ||
    host.endsWith('.mercadolibre.com')
  );
}

function isAllowedHop(url: URL): boolean {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (url.username || url.password) return false;
  return isMercadoLivreHost(url.hostname) || SHORTENER_HOSTS.has(normalizeHost(url.hostname));
}

/**
 * Chave de deduplicação estável para o mesmo produto, independente do encurtador, do
 * grupo de origem ou dos parâmetros de rastreio: o ID MLB quando existe, senão a URL
 * canônica sem query.
 */
// Parâmetros que mudam a cada compartilhamento sem mudar a oferta.
const TRACKING_PARAM_PATTERN = /^(utm_.*|matt_.*|tag|ref|tracking_id|c_id|c_uid|sid|source|forceinapp|reco_.*)$/i;

export function buildDedupKey(url: URL): string {
  const mlbId = url.href.match(/MLB-?(\d{5,})/i);
  if (mlbId) return `ml:MLB${mlbId[1]}`;

  // Sem ID de produto: a query distingue ofertas diferentes na mesma página (ex.: /ofertas?promotion_id=...).
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  const query = [...url.searchParams.entries()]
    .filter(([name]) => !TRACKING_PARAM_PATTERN.test(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  return `ml:url:${normalizeHost(url.hostname)}${path}${query ? `?${query}` : ''}`;
}

export interface ResolvedDeal {
  finalUrl: string;
  affiliateUrl: string;
  dedupKey: string;
}

export async function resolveMercadoLivreLink(rawUrl: string): Promise<ResolvedDeal | null> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return null;
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedHop(current)) {
      console.log(`[Link] URL ignorada: host não permitido (${current.hostname || current.protocol}).`);
      return null;
    }

    let response;
    try {
      // Redirecionamentos são seguidos manualmente para revalidar o host em cada salto.
      response = await axios.get(current.toString(), {
        maxRedirects: 0,
        timeout: REQUEST_TIMEOUT_MS,
        responseType: 'stream',
        headers: { 'User-Agent': BROWSER_USER_AGENT },
        validateStatus: () => true,
      });
    } catch (error) {
      console.log(`[Link] Falha ao acessar ${current.hostname}: ${describeError(error)}`);
      return null;
    }
    response.data?.destroy?.();

    const location = response.headers?.location;
    if (response.status >= 300 && response.status < 400 && typeof location === 'string') {
      try {
        current = new URL(location, current);
      } catch {
        return null;
      }
      continue;
    }

    // 403/429 do ML costumam ser bloqueio de robô: o link continua válido para o usuário.
    const acceptable = response.status < 300 || [403, 429].includes(response.status);
    if (!acceptable) {
      console.log(`[Link] URL ignorada: HTTP ${response.status} em ${current.hostname}.`);
      return null;
    }

    if (!isMercadoLivreHost(current.hostname)) {
      console.log(`[Link] URL ignorada: destino fora do Mercado Livre (${current.hostname}).`);
      return null;
    }

    // meli.la é o encurtador de afiliado do ML: se ele não redirecionou (ex.: 403 de robô),
    // publicá-lo manteria a atribuição de quem criou o link, não a nossa.
    if (normalizeHost(current.hostname) === 'meli.la') {
      console.log(`[Link] URL ignorada: meli.la não redirecionou (HTTP ${response.status}).`);
      return null;
    }

    // Página de afiliado (/social/<afiliado>?ref=...): o caminho credita quem postou e o produto
    // vem criptografado no ref. Em vez de republicar esse link, extraímos da página o link do
    // produto e aplicamos a nossa tag nele.
    if (/^\/social\//i.test(current.pathname)) {
      const productUrl = await fetchSocialProductUrl(current);
      if (!productUrl) {
        console.log('[Link] URL ignorada: página de afiliado sem produto identificável (/social/).');
        return null;
      }
      console.log(`[Link] Página de afiliado convertida para o produto: ${productUrl}`);
      current = new URL(productUrl);
    }

    const finalUrl = current.toString();
    return { finalUrl, affiliateUrl: buildAffiliateUrl(finalUrl), dedupKey: buildDedupKey(current) };
  }

  console.log('[Link] URL ignorada: redirecionamentos demais.');
  return null;
}

const MAX_SOCIAL_PAGE_BYTES = 3 * 1024 * 1024;

/**
 * Extrai o link do produto principal de uma página /social/<afiliado> do ML.
 * A página traz o produto da oferta e vários recomendados; o principal é o "gatilho"
 * das recomendações (trigger_type "product").
 */
export function extractSocialProductUrl(html: string): string | null {
  const text = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const trigger = text.match(/"trigger":\{"trigger_type":"product","item_info":\{"id":"MLB(\d+)"/);
  if (!trigger) return null;

  const digits = trigger[1];
  const productLink = new RegExp(
    `https://(?:www\\.|produto\\.)?mercadolivre\\.com\\.br/[^"'\\s<>?#]*?(?:/p/MLB${digits}|MLB-${digits})(?!\\d)[^"'\\s<>?#]*`,
    'i',
  );
  return text.match(productLink)?.[0] ?? null;
}

async function fetchSocialProductUrl(socialUrl: URL): Promise<string | null> {
  try {
    const response = await axios.get(socialUrl.toString(), {
      maxRedirects: 0,
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: MAX_SOCIAL_PAGE_BYTES,
      headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Language': 'pt-BR' },
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return extractSocialProductUrl(String(response.data));
  } catch (error) {
    console.log(`[Link] Falha ao ler a página de afiliado: ${describeError(error)}`);
    return null;
  }
}

export async function shortenUrl(url: string): Promise<string> {
  try {
    const response = await axios.get('https://is.gd/create.php', {
      params: { format: 'simple', url },
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const shortenedUrl = String(response.data).trim();

    if (!/^https?:\/\/is\.gd\/[A-Za-z0-9]+$/.test(shortenedUrl)) {
      throw new Error('O encurtador retornou uma resposta inválida.');
    }

    return shortenedUrl;
  } catch (error) {
    console.error(`[Link] Não foi possível encurtar o link afiliado; usando o link completo: ${describeError(error)}`);
    return url;
  }
}

// Só caracteres válidos em URL: emoji, "…", "»" e aspas grudados no link ficam de fora.
const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%]+/gi;

export function extractUrls(text: string): string[] {
  const urls = (text.match(URL_PATTERN) || []).map((url) => url.replace(/[.,!?;:'*]+$/, ''));
  // Deduplica depois de limpar a pontuação, senão "link." e "link" contam como dois.
  return [...new Set(urls)];
}
