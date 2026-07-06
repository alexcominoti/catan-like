/**
 * Chat da partida (networked) — NÚCLEO PURO. Só a sanitização da mensagem é
 * testável aqui; o broadcast/rate-limit vive no server.ts (transporte WS).
 */

/** Tamanho máximo de uma mensagem de chat. */
export const CHAT_MAX_LEN = 200;

/**
 * Sanitiza uma mensagem: troca caracteres de controle por espaço, colapsa
 * espaços e corta no limite. Devolve string vazia se não sobrar nada (descarta).
 */
export function sanitizeChatText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const noCtrl = raw.replace(/[\x00-\x1F\x7F]+/g, ' ');
  return noCtrl.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
}
