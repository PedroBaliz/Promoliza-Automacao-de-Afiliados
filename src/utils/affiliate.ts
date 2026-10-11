/**
 * Converte a URL padrão do produto em uma URL com a tag de afiliado
 */
export function buildAffiliateUrl(originalUrl: string): string {
  const affiliateTag = process.env.MLB_AFFILIATE_TAG;

  if (!affiliateTag) {
    return originalUrl;
  }

  // Insere o parâmetro de afiliado na URL do Mercado Livre
  const separator = originalUrl.includes('?') ? '&' : '?';
  return `${originalUrl}${separator}matt=sua_tag_${affiliateTag}`;
}