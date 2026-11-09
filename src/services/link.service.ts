import axios from 'axios';
import { buildAffiliateUrl } from '../utils/affiliate';

const MERCADO_LIVRE_HOSTS = new Set([
  'mercadolivre.com.br',
  'mercadolivre.com',
  'produto.mercadolivre.com.br',
]);

function isMercadoLivreHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/^www\./, '');
  return MERCADO_LIVRE_HOSTS.has(normalizedHostname);
}

export async function resolveMercadoLivreLink(rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol)) return null;

  try {
    const response = await axios.get(url.toString(), {
      maxRedirects: 5,
      timeout: 10000,
      responseType: 'stream',
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const finalUrl = new URL(
      response.request?.res?.responseUrl || response.request?.responseURL || url.toString(),
    );
    response.data.destroy();
    if (!isMercadoLivreHost(finalUrl.hostname)) return null;
    return buildAffiliateUrl(finalUrl.toString());
  } catch {
    return null;
  }
}

export function extractUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>()]+/gi) || [])]
    .map((url) => url.replace(/[.,!?;:]+$/, ''));
}
