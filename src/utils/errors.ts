import axios from 'axios';

// Tokens de bot aparecem na URL da Bot API (https://api.telegram.org/bot<TOKEN>/...).
const BOT_TOKEN_PATTERN = /bot\d{5,}:[\w-]{20,}/g;
// O mesmo token sem o prefixo "bot" (ex.: citado numa mensagem de erro).
const BARE_TOKEN_PATTERN = /\b\d{8,10}:[\w-]{30,}/g;

export function redactSecrets(text: string): string {
  return text.replace(BOT_TOKEN_PATTERN, 'bot***').replace(BARE_TOKEN_PATTERN, '***');
}

/**
 * Descreve um erro em uma linha, sem objetos internos. Um AxiosError impresso inteiro
 * inclui config.url, ou seja, o token do bot, por isso ele nunca deve ir direto para o log.
 */
export function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const description = (error.response?.data as { description?: string } | undefined)?.description;
    const detail = description || error.code || error.message;
    return redactSecrets(status ? `HTTP ${status}: ${detail}` : detail);
  }
  if (error instanceof Error) return redactSecrets(`${error.name}: ${error.message}`);
  return redactSecrets(String(error));
}
