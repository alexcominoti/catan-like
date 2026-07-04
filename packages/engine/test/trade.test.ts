import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/setup.js';
import { reduce, embargoed } from '../src/reduce.js';
import type { GameState, Resource } from '../src/types.js';

/** Estado em fase principal com red na vez; hands controladas para o teste. */
function mainState(hands: Partial<Record<'red' | 'blue', Partial<Record<Resource, number>>>> = {}): GameState {
  const s = createInitialState({
    seed: 1,
    players: [
      { color: 'red', name: 'R' },
      { color: 'blue', name: 'B' },
      { color: 'white', name: 'W' },
    ],
  });
  s.phase = 'main';
  s.currentPlayer = 'red';
  for (const [color, hand] of Object.entries(hands) as ['red' | 'blue', Partial<Record<Resource, number>>][]) {
    const p = s.players.find((pl) => pl.color === color)!;
    for (const [r, n] of Object.entries(hand) as [Resource, number][]) p.hand[r] = n;
  }
  return s;
}

describe('embargo comercial', () => {
  it('setEmbargo liga/desliga e vale nos dois sentidos', () => {
    const s = mainState();
    const on = reduce(s, 'red', { t: 'setEmbargo', target: 'blue', on: true });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    expect(embargoed(on.state, 'red', 'blue')).toBe(true);
    expect(embargoed(on.state, 'blue', 'red')).toBe(true); // qualquer direção

    const off = reduce(on.state, 'red', { t: 'setEmbargo', target: 'blue', on: false });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(embargoed(off.state, 'red', 'blue')).toBe(false);
  });

  it('não deixa embargar a si mesmo', () => {
    expect(reduce(mainState(), 'red', { t: 'setEmbargo', target: 'red', on: true }).ok).toBe(false);
  });

  it('proposta exclui quem está em embargo; sem destinatários vira erro', () => {
    const s0 = mainState({ red: { wood: 2 } });
    const emb = reduce(s0, 'red', { t: 'setEmbargo', target: 'blue', on: true });
    expect(emb.ok).toBe(true);
    if (!emb.ok) return;
    // Oferta só para blue (embargado) → erro.
    const only = reduce(emb.state, 'red', { t: 'proposeTrade', give: { wood: 1 }, want: { brick: 1 }, to: ['blue'] });
    expect(only.ok).toBe(false);
    // Oferta para todos → blue é filtrado, sobra white.
    const all = reduce(emb.state, 'red', { t: 'proposeTrade', give: { wood: 1 }, want: { brick: 1 } });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.state.activeTrade!.to).toEqual(['white']);
  });
});

describe('carta coringa (wantAny)', () => {
  it('fluxo completo: propõe coringa, aceitante escolhe recursos, fecha', () => {
    const s = mainState({ red: { wood: 1 }, blue: { brick: 1 } });
    // red oferece 1 madeira por "1 recurso qualquer".
    const prop = reduce(s, 'red', { t: 'proposeTrade', give: { wood: 1 }, want: {}, wantAny: 1, to: ['blue'] });
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    expect(prop.state.activeTrade!.wantAny).toBe(1);

    // Aceitar sem escolher o coringa → erro.
    expect(reduce(prop.state, 'blue', { t: 'respondTrade', accept: true }).ok).toBe(false);

    // Aceitar escolhendo 1 tijolo (que blue tem).
    const acc = reduce(prop.state, 'blue', { t: 'respondTrade', accept: true, resolveAny: { brick: 1 } });
    expect(acc.ok).toBe(true);
    if (!acc.ok) return;
    expect(acc.state.activeTrade!.accepted).toContain('blue');

    // red fecha com blue → recursos trocam (red dá madeira, blue dá o tijolo escolhido).
    const done = reduce(acc.state, 'red', { t: 'confirmTrade', with: 'blue' });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const red = done.state.players.find((p) => p.color === 'red')!;
    const blue = done.state.players.find((p) => p.color === 'blue')!;
    expect(red.hand.wood).toBe(0);
    expect(red.hand.brick).toBe(1);
    expect(blue.hand.brick).toBe(0);
    expect(blue.hand.wood).toBe(1);
    expect(done.state.activeTrade).toBeNull();
  });

  it('recusa a escolha do coringa que o aceitante não possui', () => {
    const s = mainState({ red: { wood: 1 }, blue: {} });
    const prop = reduce(s, 'red', { t: 'proposeTrade', give: { wood: 1 }, want: {}, wantAny: 1, to: ['blue'] });
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    // blue não tem tijolo → não pode resolver o coringa com brick.
    expect(reduce(prop.state, 'blue', { t: 'respondTrade', accept: true, resolveAny: { brick: 1 } }).ok).toBe(false);
  });
});
