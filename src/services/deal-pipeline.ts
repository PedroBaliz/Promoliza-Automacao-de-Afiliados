import { resolveMercadoLivreLink, shortenUrl } from './link.service';

export interface Deal {
  dedupKey: string;
  affiliateUrl: string;
  sourceCaption: string;
  image?: Buffer;
}

/** Destino das ofertas encontradas: quem decide se já foi publicada e quem publica. */
export interface DealSink {
  isAlreadyPosted(dedupKey: string): boolean;
  publish(deal: Deal): Promise<void>;
}

export interface DealCandidate {
  /** URLs encontradas na mensagem de origem (qualquer loja; só as do Mercado Livre viram oferta). */
  rawUrls: string[];
  /** Texto da mensagem de origem já sem os links. */
  sourceCaption: string;
  /** Baixa a imagem da mensagem só quando há oferta nova para publicar. */
  loadImage: () => Promise<Buffer | undefined>;
  /** Prefixo dos logs, ex.: "[TelegramSource]". */
  logTag: string;
}

/**
 * Etapa comum a todas as origens: filtra os links do Mercado Livre, descarta duplicadas,
 * converte para afiliado, encurta e publica a mensagem inteira com o link convertido.
 */
export async function publishDeals(candidate: DealCandidate, sink: DealSink): Promise<void> {
  const { rawUrls, sourceCaption, loadImage, logTag } = candidate;
  const seenKeys = new Set<string>();
  let image: Buffer | undefined;
  let imageLoaded = false;

  for (const rawUrl of rawUrls) {
    const deal = await resolveMercadoLivreLink(rawUrl);
    if (!deal) {
      console.log(`${logTag} URL ignorada: não é um link válido do Mercado Livre: ${rawUrl}`);
      continue;
    }

    // Checa a duplicidade antes de encurtar e baixar a mídia, para não gastar requisições.
    if (seenKeys.has(deal.dedupKey) || sink.isAlreadyPosted(deal.dedupKey)) {
      console.log(`[Promoliza] Oferta ignorada: ${deal.dedupKey} já enviada hoje.`);
      continue;
    }
    seenKeys.add(deal.dedupKey);

    const shortenedUrl = await shortenUrl(deal.affiliateUrl);
    if (!imageLoaded) {
      image = await loadImage();
      imageLoaded = true;
    }
    console.log(
      `${logTag} Link do Mercado Livre encontrado; mídia=${image ? `${image.length} bytes` : 'não encontrada'}.`,
    );
    await sink.publish({ dedupKey: deal.dedupKey, affiliateUrl: shortenedUrl, sourceCaption, image });
  }
}
