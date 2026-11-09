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
    if (/^\/social(?:\/|$)/i.test(finalUrl.pathname)) {
      console.warn(`[Link] Destino ignorado: página de perfil do Mercado Livre: ${finalUrl.toString()}`);
      return null;
    }
    return buildAffiliateUrl(finalUrl.toString());
  } catch {
    return null;
  }
}

export async function shortenUrl(url: string): Promise<string> {
  try {
    const response = await axios.get('https://is.gd/create.php', {
      params: { format: 'simple', url },
      timeout: 10000,
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const shortenedUrl = response.data.trim();

    if (!/^https?:\/\/is\.gd\/[A-Za-z0-9]+$/.test(shortenedUrl)) {
      throw new Error('O encurtador retornou uma resposta inválida.');
    }

    return shortenedUrl;
  } catch (error) {
    console.error('[Link] Não foi possível encurtar o link afiliado; usando o link completo:', error);
    return url;
  }
}

export function extractUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>()]+/gi) || [])]
    .map((url) => url.replace(/[.,!?;:]+$/, ''));
}
