import { describe, expect, it } from 'vitest';
import { createInitialState, reduce, type GameState } from '@hexgame/engine';
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
});
