import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/setup.js';
import { reduce } from '../src/reduce.js';
import { distanceRuleOk, longestRoadLength } from '../src/rules.js';
import type { Action, GameState, PlayerColor } from '../src/types.js';

/** Completa a fase de setup escolhendo colocacoes validas; registra as acoes. */
function autoSetup(state: GameState): { state: GameState; actions: { by: PlayerColor; action: Action }[] } {
  let cur = state;
  const actions: { by: PlayerColor; action: Action }[] = [];
  let guard = 0;
  while ((cur.phase === 'setup1' || cur.phase === 'setup2') && guard++ < 100) {
    const by = cur.currentPlayer;
    let action: Action;
    if (!cur.setupLastVertex) {
      const vid = cur.board.vertexOrder.find((v) => distanceRuleOk(cur, v));
      if (!vid) throw new Error('sem vertice valido');
      action = { t: 'placeSettlement', vertexId: vid };
    } else {
      const v = cur.board.vertices[cur.setupLastVertex]!;
      const eid = v.edges.find((e) => !cur.roads[e]);
      if (!eid) throw new Error('sem aresta livre');
      action = { t: 'placeRoad', edgeId: eid };
    }
    const r = reduce(cur, by, action);
    if (!r.ok) throw new Error(`setup falhou: ${r.error}`);
    actions.push({ by, action });
    cur = r.state;
  }
  return { state: cur, actions };
}

describe('fluxo de jogo', () => {
  it('completa o setup das 4 vilas+estradas e vai para a fase de rolar', () => {
    const s0 = createInitialState({ seed: 123 });
    const { state, actions } = autoSetup(s0);
    expect(state.phase).toBe('roll');
    expect(state.currentPlayer).toBe(state.players[0]!.color);
    // 8 vilas + 8 estradas colocadas (2 por jogador).
    expect(Object.keys(state.buildings)).toHaveLength(8);
    expect(Object.keys(state.roads)).toHaveLength(8);
    expect(actions.length).toBe(16);
  });

  it('rejeita colocar vila em vertice que viola a regra de distancia', () => {
    const s0 = createInitialState({ seed: 5 });
    const v0 = s0.board.vertexOrder[0]!;
    const r1 = reduce(s0, s0.currentPlayer, { t: 'placeSettlement', vertexId: v0 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // coloca a estrada para passar a vez
    const edge = s0.board.vertices[v0]!.edges[0]!;
    const r2 = reduce(r1.state, r1.state.currentPlayer, { t: 'placeRoad', edgeId: edge });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // proximo jogador tenta colocar vizinho de v0 -> deve falhar
    const neighbor = s0.board.vertices[v0]!.adj[0]!;
    const r3 = reduce(r2.state, r2.state.currentPlayer, { t: 'placeSettlement', vertexId: neighbor });
    expect(r3.ok).toBe(false);
  });

  it('rolar dados produz recursos ou aciona o bloqueador (7)', () => {
    const s0 = createInitialState({ seed: 999 });
    const { state } = autoSetup(s0);
    const r = reduce(state, state.currentPlayer, { t: 'rollDice' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.dice).not.toBeNull();
    const sum = r.state.dice![0] + r.state.dice![1];
    if (sum === 7) {
      expect(['discard', 'moveBlocker']).toContain(r.state.phase);
    } else {
      expect(r.state.phase).toBe('main');
    }
  });

  it('e deterministico: mesma seed + mesmas acoes => mesmo estado (replay)', () => {
    const a = createInitialState({ seed: 2024 });
    const { state: stateA, actions } = autoSetup(a);
    // adiciona uma rolagem de dados a sequencia
    const rolled = reduce(stateA, stateA.currentPlayer, { t: 'rollDice' });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    actions.push({ by: stateA.currentPlayer, action: { t: 'rollDice' } });

    // replay do zero
    let b = createInitialState({ seed: 2024 });
    for (const { by, action } of actions) {
      const r = reduce(b, by, action);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      b = r.state;
    }
    expect(JSON.stringify(b)).toEqual(JSON.stringify(rolled.state));
  });

  it('calcula a maior trilha de estradas conectadas', () => {
    const s = createInitialState({ seed: 1 });
    // injeta uma cadeia de estradas conectadas para o jogador red
    const start = s.board.vertexOrder.find((v) => s.board.vertices[v]!.edges.length >= 2)!;
    const visited = new Set<string>([start]);
    let cur = start;
    let chain = 0;
    while (chain < 5) {
      const v = s.board.vertices[cur]!;
      const edge = v.edges
        .map((e) => s.board.edges[e]!)
        .find((e) => {
          const other = e.v[0] === cur ? e.v[1] : e.v[0];
          return !visited.has(other) && !s.roads[e.id];
        });
      if (!edge) break;
      s.roads[edge.id] = { owner: 'red', edgeId: edge.id };
      const other = edge.v[0] === cur ? edge.v[1] : edge.v[0];
      visited.add(other);
      cur = other;
      chain++;
    }
    expect(longestRoadLength(s, 'red')).toBeGreaterThanOrEqual(chain);
    expect(longestRoadLength(s, 'blue')).toBe(0);
  });
});
