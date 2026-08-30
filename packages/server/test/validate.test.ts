import { describe, it, expect } from 'vitest';
import { createInitialState, reduce } from '@trevalis/engine';
import { parseClientMessage } from '../src/validate.js';

describe('parseClientMessage (envelope do WebSocket)', () => {
  it('aceita as quatro mensagens legítimas', () => {
    expect(parseClientMessage({ t: 'enter', code: 'ABC123' })).toEqual({ t: 'enter', code: 'ABC123' });
    expect(parseClientMessage({ t: 'action', action: { t: 'endTurn' } })).toEqual({
      t: 'action',
      action: { t: 'endTurn' },
    });
    expect(parseClientMessage({ t: 'select', action: { t: 'discard', hand: {} } })).toEqual({
      t: 'select',
      action: { t: 'discard', hand: {} },
    });
    expect(parseClientMessage({ t: 'chat', text: 'oi' })).toEqual({ t: 'chat', text: 'oi' });
  });

  it('rejeita a ação nula que derrubava o processo', () => {
    // Regressão: {"t":"action","action":null} fazia o reduce lançar, a exceção
    // escapava do handler assíncrono e o Node encerrava o processo inteiro.
    expect(parseClientMessage({ t: 'action', action: null })).toBeNull();
    expect(parseClientMessage({ t: 'select', action: null })).toBeNull();
  });

  it('rejeita enter sem código válido', () => {
    expect(parseClientMessage({ t: 'enter' })).toBeNull();
    expect(parseClientMessage({ t: 'enter', code: 123 })).toBeNull();
    expect(parseClientMessage({ t: 'enter', code: 'AB' })).toBeNull();
    expect(parseClientMessage({ t: 'enter', code: 'ABC/../123' })).toBeNull();
  });

  it('rejeita envelopes malformados e tipos desconhecidos', () => {
    for (const bad of [null, undefined, 42, 'texto', [], {}, { t: 'admin' }, { t: 42 }]) {
      expect(parseClientMessage(bad)).toBeNull();
    }
  });

  it('rejeita ação sem discriminante e chat que não é string', () => {
    expect(parseClientMessage({ t: 'action', action: {} })).toBeNull();
    expect(parseClientMessage({ t: 'action', action: [] })).toBeNull();
    expect(parseClientMessage({ t: 'action', action: 'endTurn' })).toBeNull();
    expect(parseClientMessage({ t: 'chat', text: 42 })).toBeNull();
    expect(parseClientMessage({ t: 'chat', text: 'x'.repeat(5000) })).toBeNull();
  });

  it('o que passa pelo filtro nunca faz o motor lançar', () => {
    const state = createInitialState({ seed: 1 });
    const payloads: unknown[] = [
      { t: 'action', action: null },
      { t: 'action', action: { t: 'discard' } },
      { t: 'action', action: { t: 'discard', hand: null } },
      { t: 'action', action: { t: 'proposeTrade', give: 'x', want: 1 } },
      { t: 'action', action: { t: 'placeSettlement', vertexId: { a: 1 } } },
      { t: 'action', action: { t: 'moveBlocker', hexId: [] } },
      { t: 'action', action: { t: 'playMonopoly', resource: {} } },
      { t: 'action', action: { t: 'naoExiste' } },
    ];
    for (const raw of payloads) {
      const msg = parseClientMessage(raw);
      if (msg?.t !== 'action') continue;
      expect(() => reduce(state, 'red', msg.action)).not.toThrow();
    }
  });
});
