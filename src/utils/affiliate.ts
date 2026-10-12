/**
 * Applies Mercado Livre affiliate tracking only to valid Mercado Livre links.
 * URLs from other marketplaces are returned unchanged.
 */
export function buildAffiliateUrl(originalUrl: string): string {
  let url: URL;
  try {
    url = new URL(originalUrl);
  } catch {
    throw new Error('O link do produto não é uma URL válida.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('O link do produto precisa usar HTTP ou HTTPS.');
  }

  const host = url.hostname.toLowerCase();
  const isMercadoLivre = host === 'mercadolivre.com.br'
    || host.endsWith('.mercadolivre.com.br')
    || host === 'mercadolibre.com'
    || host.endsWith('.mercadolibre.com')
    || host === 'meli.la';

  if (!isMercadoLivre) return url.toString();

  const affiliateTag = (process.env.MLB_AFFILIATE_TAG || '').trim();
  if (!affiliateTag) return url.toString();

  url.searchParams.set('matt', affiliateTag);
  return url.toString();
}
