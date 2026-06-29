import { describe, expect, it } from 'vitest';
import { createInitialState, reduce, type GameState } from '@trevalis/engine';
import { planBotAction, type Difficulty } from '../src/index.js';

/** Roda uma partida so de bots (nivel dado) ate o fim ou o limite de passos. */
function playOut(seed: number, level: Difficulty, maxSteps = 80000): { state: GameState; steps: number } {
  let state = createInitialState({ seed });
  const isBot = () => true;
  const diff = () => level;
  let steps = 0;
  while (steps < maxSteps) {
    const move = planBotAction(state, isBot, diff);
    if (!move) break;
    const r = reduce(state, move.by, move.action);
    if (!r.ok) {
      throw new Error(`acao ilegal (${level}) no passo ${steps}: ${r.error} (${JSON.stringify(move.action)})`);
    }
    state = r.state;
    steps++;
    if (state.phase === 'ended') break;
  }
  return { state, steps };
}

describe('bot heuristico', () => {
  for (const level of ['easy', 'medium', 'hard'] as Difficulty[]) {
    for (const seed of [1, 42, 2024]) {
      it(`termina uma partida 4-bots (${level}, seed ${seed})`, () => {
        const { state, steps } = playOut(seed, level);
        expect(state.phase).toBe('ended');
        expect(state.winner).not.toBeNull();
        expect(steps).toBeGreaterThan(16);
      });
    }
  }

  it('so propoe acoes legais (nenhuma rejeicao do reducer)', () => {
    expect(() => playOut(123, 'hard')).not.toThrow();
  });

  it('ladrao amigavel: bots jogam legalmente e a partida termina', () => {
    for (const seed of [4, 17, 99]) {
      let state = createInitialState({ seed, friendlyRobber: true });
      let steps = 0;
      while (steps < 80000) {
        const move = planBotAction(state, () => true, () => 'hard');
        if (!move) break;
        const r = reduce(state, move.by, move.action);
        if (!r.ok) throw new Error(`ladrao amigavel ilegal (seed ${seed}, passo ${steps}): ${r.error}`);
        state = r.state;
        steps++;
        if (state.phase === 'ended') break;
      }
      expect(state.phase).toBe('ended');
    }
  });

  it('tabuleiro GRANDE: partida de 6 bots termina com vencedor', () => {
    const players = (['red', 'blue', 'white', 'orange', 'green', 'brown'] as const).map((c, i) => ({ color: c, name: `J${i + 1}` }));
    let state = createInitialState({ seed: 9, boardLayout: 'large', players: [...players] });
    let steps = 0;
    while (steps < 200000) {
      const move = planBotAction(state, () => true, () => 'medium');
      if (!move) break;
      const r = reduce(state, move.by, move.action);
      if (!r.ok) throw new Error(`acao ilegal (grande) no passo ${steps}: ${r.error} (${JSON.stringify(move.action)})`);
      state = r.state;
      steps++;
      if (state.phase === 'ended') break;
    }
    expect(state.phase).toBe('ended');
    expect(state.winner).not.toBeNull();
  });

  it('tabuleiro GIGANTE: partida de 8 bots termina com vencedor', () => {
    const players = (['red', 'blue', 'white', 'orange', 'green', 'brown', 'purple', 'pink'] as const).map((c, i) => ({ color: c, name: `J${i + 1}` }));
    let state = createInitialState({ seed: 11, boardLayout: 'huge', players: [...players] });
    let steps = 0;
    while (steps < 300000) {
      const move = planBotAction(state, () => true, () => 'medium');
      if (!move) break;
      const r = reduce(state, move.by, move.action);
      if (!r.ok) throw new Error(`acao ilegal (gigante) no passo ${steps}: ${r.error}`);
      state = r.state;
      steps++;
      if (state.phase === 'ended') break;
    }
    expect(state.phase).toBe('ended');
    expect(state.winner).not.toBeNull();
  });
});
