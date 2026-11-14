// Parâmetros de afiliado que podem vir no link do grupo de origem. Eles são sempre
// removidos antes de aplicar a nossa tag, senão a comissão pode ir para quem postou a oferta.
const SOURCE_AFFILIATE_PARAMS = ['matt_word', 'matt_tool', 'tag'];

export type AffiliateTag =
  | { kind: 'none' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'matt'; word: string; tool: string }
  | { kind: 'tag'; value: string };

export function parseAffiliateTag(raw: string | undefined = process.env.ML_AFFILIATE_TAG): AffiliateTag {
  const value = (raw || '').trim();
  if (!value) return { kind: 'none' };

  if (value.startsWith('matt:')) {
    const parts = value.split(':').map((part) => part.trim());
    if (parts.length !== 3 || !parts[1] || !parts[2]) {
      return { kind: 'invalid', reason: 'use o formato matt:<matt_word>:<matt_tool>' };
    }
    return { kind: 'matt', word: parts[1], tool: parts[2] };
  }

  return { kind: 'tag', value };
}

export function buildAffiliateUrl(originalUrl: string): string {
  if (!originalUrl) return '';

  const affiliateTag = parseAffiliateTag();
  if (affiliateTag.kind === 'none') return originalUrl;

  try {
    const url = new URL(originalUrl);
    for (const param of SOURCE_AFFILIATE_PARAMS) url.searchParams.delete(param);

    if (affiliateTag.kind === 'matt') {
      url.searchParams.set('matt_word', affiliateTag.word);
      url.searchParams.set('matt_tool', affiliateTag.tool);
    } else if (affiliateTag.kind === 'tag') {
      url.searchParams.set('tag', affiliateTag.value);
    }
    // kind === 'invalid': a inicialização já recusa esse caso; aqui só garantimos que
    // o afiliado da origem não fique no link.

    return url.toString();
  } catch (error) {
    console.error('❌ Erro ao formatar URL de afiliado:', error instanceof Error ? error.message : error);
    return originalUrl;
  }
}
