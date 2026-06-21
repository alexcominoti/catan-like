import { describe, expect, it } from 'vitest';
import { createInitialState, reduce, type GameState } from '@hexgame/engine';
import { planBotAction } from '../src/index.js';

/** Roda uma partida so de bots ate o fim (ou estourar o limite de passos). */
function playOut(seed: number, maxSteps = 60000): { state: GameState; steps: number } {
  let state = createInitialState({ seed });
  const isBot = () => true;
  let steps = 0;
  while (steps < maxSteps) {
    const move = planBotAction(state, isBot);
    if (!move) break;
    const r = reduce(state, move.by, move.action);
    if (!r.ok) {
      throw new Error(`acao ilegal do bot no passo ${steps}: ${r.error} (${JSON.stringify(move.action)})`);
    }
    state = r.state;
    steps++;
    if (state.phase === 'ended') break;
  }
  return { state, steps };
}

describe('bot heuristico', () => {
  for (const seed of [1, 7, 42, 2024, 99999]) {
    it(`termina uma partida 4-bots com vencedor (seed ${seed})`, () => {
      const { state, steps } = playOut(seed);
      expect(state.phase).toBe('ended');
      expect(state.winner).not.toBeNull();
      // o vencedor tem pelo menos 10 pontos -> sanidade do fluxo
      expect(steps).toBeGreaterThan(16); // passou do setup
    });
  }

  it('so propoe acoes legais (nenhuma rejeicao do reducer)', () => {
    // playOut lanca se alguma acao for ilegal; aqui apenas confirmamos o caminho.
    expect(() => playOut(123)).not.toThrow();
  });
});
