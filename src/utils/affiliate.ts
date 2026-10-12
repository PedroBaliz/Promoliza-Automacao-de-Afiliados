/**
 * Converte a URL padrão do produto em uma URL com a tag de afiliado
 */
export function buildAffiliateUrl(originalUrl: string): string {
  const affiliateTag = (process.env.MLB_AFFILIATE_TAG || '').trim();

  if (!affiliateTag) {
    return originalUrl;
  }

  const separator = originalUrl.includes('?') ? '&' : '?';
  return `${originalUrl}${separator}matt=${encodeURIComponent(affiliateTag)}`;
}
