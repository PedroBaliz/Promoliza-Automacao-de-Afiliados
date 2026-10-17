export function buildAffiliateUrl(originalUrl: string): string {
  if (!originalUrl) return '';

  const affiliateTag = process.env.ML_AFFILIATE_TAG || '';

  if (!affiliateTag) {
    return originalUrl;
  }

  try {
    const url = new URL(originalUrl);

    // Formato Matt Tool (ex: matt:username:toolid)
    if (affiliateTag.startsWith('matt:')) {
      const [, mattWord, mattTool] = affiliateTag.split(':');
      if (mattWord && mattTool) {
        url.searchParams.set('matt_word', mattWord);
        url.searchParams.set('matt_tool', mattTool);
      }
    } else {
      // Formato de Tag Simples
      url.searchParams.set('tag', affiliateTag);
    }

    return url.toString();
  } catch (error) {
    console.error('❌ Erro ao formatar URL de afiliado:', error);
    return originalUrl;
  }
}