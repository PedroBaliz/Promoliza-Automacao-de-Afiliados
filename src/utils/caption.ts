// Limites da Bot API do Telegram (contados em unidades UTF-16, como String.length no JS).
export const TELEGRAM_CAPTION_LIMIT = 1024;
export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Monta "texto da oferta + link", cortando só o texto da origem para caber no limite.
 * O link de afiliado fica sempre inteiro no final.
 */
export function buildCaption(sourceCaption: string, affiliateUrl: string, limit: number): string {
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
