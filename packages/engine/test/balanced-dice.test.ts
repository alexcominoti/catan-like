import { describe, expect, it } from 'vitest';
import { allDiceCombos, createInitialState } from '../src/setup.js';
import { reduce } from '../src/reduce.js';
import { projectFor } from '../src/project.js';
import { distanceRuleOk } from '../src/rules.js';
import type { Action, GameState, PlayerColor } from '../src/types.js';

/** Completa o setup escolhendo colocacoes validas (igual ao flow.test). */
function autoSetup(state: GameState): GameState {
  let cur = state;
  let guard = 0;
  while ((cur.phase === 'setup1' || cur.phase === 'setup2') && guard++ < 100) {
    const by = cur.currentPlayer;
    let action: Action;
    if (!cur.setupLastVertex) {
      action = { t: 'placeSettlement', vertexId: cur.board.vertexOrder.find((v) => distanceRuleOk(cur, v))! };
    } else {
      const eid = cur.board.vertices[cur.setupLastVertex]!.edges.find((e) => !cur.roads[e])!;
      action = { t: 'placeRoad', edgeId: eid };
    }
    const r = reduce(cur, by, action);
    if (!r.ok) throw new Error(r.error);
    cur = r.state;
  }
  return cur;
}

const key = (c: [number, number]) => `${c[0]}-${c[1]}`;

describe('allDiceCombos', () => {
  it('são as 36 combinações únicas de 2d6', () => {
    const all = allDiceCombos();
    expect(all).toHaveLength(36);
    expect(new Set(all.map(key)).size).toBe(36);
    // A distribuição de somas segue a teórica (ex.: 7 aparece 6 vezes; 2 e 12, uma).
    const sums = all.map((c) => c[0] + c[1]);
    expect(sums.filter((s) => s === 7)).toHaveLength(6);
    expect(sums.filter((s) => s === 2)).toHaveLength(1);
    expect(sums.filter((s) => s === 12)).toHaveLength(1);
  });
});

describe('dados balanceados no setup', () => {
  it('ligado: cria um saco = permutação das 36 combinações', () => {
    const s = createInitialState({ seed: 7, balancedDice: true });
    expect(s.balancedDice).toBe(true);
    expect(s.diceBag).toHaveLength(36);
    expect(new Set(s.diceBag!.map(key))).toEqual(new Set(allDiceCombos().map(key)));
  });

  it('desligado (default): sem saco', () => {
    const s = createInitialState({ seed: 7 });
    expect(s.balancedDice).toBe(false);
    expect(s.diceBag).toBeUndefined();
  });

  it('é determinístico: mesma seed => mesmo saco', () => {
    const a = createInitialState({ seed: 42, balancedDice: true });
    const b = createInitialState({ seed: 42, balancedDice: true });
    expect(a.diceBag).toEqual(b.diceBag);
  });

  it('a projeção esconde o saco (não revela rolagens futuras) mas mantém a flag', () => {
    const s = createInitialState({ seed: 7, balancedDice: true });
    const view = projectFor(s, s.players[0]!.color);
    expect(view.diceBag).toBeUndefined();
    expect(view.balancedDice).toBe(true);
  });
});

describe('rolagem com dados balanceados', () => {
  it('consome a próxima combinação do saco ao rolar', () => {
    const s = autoSetup(createInitialState({ seed: 5, balancedDice: true }));
    const nextCombo = s.diceBag![s.diceBag!.length - 1]!; // o topo (pop) é o fim do array
    const r = reduce(s, s.currentPlayer, { t: 'rollDice' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.dice).toEqual(nextCombo);
    expect(r.state.diceBag).toHaveLength(35);
  });

  it('um ciclo de 36 rolagens usa cada combinação exatamente uma vez', () => {
    // Testa o mecanismo do saco: re-entra em "roll" a cada iteração (ignorando a
    // produção/7, irrelevantes aqui) e coleta as combinações sorteadas.
    let s: GameState = { ...createInitialState({ seed: 9, balancedDice: true }), phase: 'roll' };
    const seen: [number, number][] = [];
    for (let i = 0; i < 36; i++) {
      const r = reduce(s, s.currentPlayer, { t: 'rollDice' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      seen.push(r.state.dice!);
      s = { ...r.state, phase: 'roll', pendingDiscards: {}, activeTrade: null };
    }
    expect(new Set(seen.map(key))).toEqual(new Set(allDiceCombos().map(key)));
    expect(s.diceBag).toHaveLength(0); // saco esvaziado ao fim do ciclo
  });
});
