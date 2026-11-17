// Limites da Bot API do Telegram (contados em unidades UTF-16, como String.length no JS).
export const TELEGRAM_CAPTION_LIMIT = 1024;
export const TELEGRAM_TEXT_LIMIT = 4096;

/** Marca, no texto da origem, onde estava o link da oferta: o link de afiliado entra no lugar. */
export const LINK_SLOT = '⟦LINK⟧';

/**
 * Monta o texto da oferta com o link de afiliado.
 * - Com LINK_SLOT: o link entra onde estava o link original (mesma formatação da origem).
 * - Sem LINK_SLOT, ou se não couber no limite: "texto + 🛒 Acessar oferta: link", cortando
 *   só o texto da origem. O link de afiliado nunca é cortado.
 */
export function buildCaption(sourceCaption: string, affiliateUrl: string, limit: number): string {
  if (sourceCaption.includes(LINK_SLOT)) {
    const inline = sourceCaption.replace(LINK_SLOT, affiliateUrl).replaceAll(LINK_SLOT, '');
    if (inline.length <= limit) return inline;
    // Não cabe com o link no meio: tira a linha do link e usa o formato com o link no fim.
    sourceCaption = sourceCaption
      .split('\n')
      .filter((line) => !line.includes(LINK_SLOT))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const suffix = `🛒 Acessar oferta: ${affiliateUrl}`;
  const separator = sourceCaption ? '\n\n' : '';
  const room = limit - suffix.length - separator.length;
  // Nem o link cabe: devolve só o link (quem chama decide enviar como texto).
  if (room <= 1) return suffix;

  let body = sourceCaption;
  if (body.length > room) {
    body = body.slice(0, Math.max(0, room - 1));
    // Não deixa meio emoji (surrogate alto sem o par) no fim do corte.
    if (/[\uD800-\uDBFF]$/.test(body)) body = body.slice(0, -1);
    body = `${body.trimEnd()}…`;
  }

  return `${body}${separator}${suffix}`;
}
