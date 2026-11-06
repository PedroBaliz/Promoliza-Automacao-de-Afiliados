import axios from 'axios';
import { buildAffiliateUrl } from '../utils/affiliate';

const MERCADO_LIVRE_HOSTS = new Set([
  'mercadolivre.com.br',
  'mercadolivre.com',
  'produto.mercadolivre.com.br',
]);

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
    const finalUrl = new URL(response.request?.res?.responseUrl || url.toString());
    response.data.destroy();
    if (!MERCADO_LIVRE_HOSTS.has(finalUrl.hostname.toLowerCase())) return null;
    return buildAffiliateUrl(finalUrl.toString());
  } catch {
    return null;
  }
}

export function extractUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>()]+/gi) || [])]
    .map((url) => url.replace(/[.,!?;:]+$/, ''));
}
