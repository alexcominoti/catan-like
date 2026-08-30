/**
 * Validacao das mensagens que chegam pelo WebSocket — NUCLEO PURO.
 *
 * Antes disto o servidor fazia `JSON.parse` e um cast direto para
 * `ClientMessage`: qualquer payload malformado ia inteiro para o motor. Uma
 * mensagem como `{"t":"action","action":null}` derrubava o PROCESSO (a excecao
 * escapava do handler assincrono como unhandled rejection), e com uma maquina
 * so isso interrompia todas as partidas vivas.
 *
 * Aqui validamos o ENVELOPE: o tipo da mensagem e o shape minimo de cada campo.
 * O CONTEUDO da acao continua sendo julgado pelo motor (`reduce`), que ja e
 * defensivo e conhece as regras — a checagem de que `action` e um objeto com um
 * `t` string basta para nada malformado chegar la.
 */
import { CHAT_MAX_LEN } from './chat.js';
import type { ClientMessage } from './protocol.js';
import type { Action } from '@trevalis/engine';

/** Formato de um codigo de sala (mesmo alfabeto/tamanho de `makeRoomCode`). */
const CODE_RE = /^[A-Za-z0-9]{4,12}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Uma acao minimamente bem formada: objeto com um discriminante `t` string. */
function isActionShape(v: unknown): v is Action {
  return isPlainObject(v) && typeof v.t === 'string' && v.t.length > 0 && v.t.length <= 40;
}

/**
 * Converte o que chegou no socket numa `ClientMessage` valida, ou `null` se a
 * mensagem for malformada (o chamador simplesmente ignora — cliente quebrado ou
 * malicioso nao merece resposta nem derruba o servidor).
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isPlainObject(raw)) return null;

  switch (raw.t) {
    case 'enter': {
      if (typeof raw.code !== 'string' || !CODE_RE.test(raw.code)) return null;
      return { t: 'enter', code: raw.code };
    }
    case 'action':
      if (!isActionShape(raw.action)) return null;
      return { t: 'action', action: raw.action };
    case 'select':
      if (!isActionShape(raw.action)) return null;
      return { t: 'select', action: raw.action };
    case 'chat': {
      // O texto ainda passa por `sanitizeChatText` no server; aqui so barramos o
      // que nem e string e o que vem absurdamente grande.
      if (typeof raw.text !== 'string' || raw.text.length > CHAT_MAX_LEN * 10) return null;
      return { t: 'chat', text: raw.text };
    }
    default:
      return null;
  }
}

/**
 * Tamanho maximo de UMA mensagem no socket. O default do `ws` e 100MB — muito
 * acima de qualquer mensagem legitima nossa (a maior e um chat de 200 chars).
 */
export const WS_MAX_PAYLOAD = 64 * 1024;
