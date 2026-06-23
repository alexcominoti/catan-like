import { describe, expect, it } from 'vitest';
import { createInitialState, reduce, PLAYER_COLORS, type PlayerColor } from '@hexgame/engine';
import { planBotAction, type Difficulty } from '../src/index.js';

declare const console: { log: (...args: unknown[]) => void };

/**
 * Self-play para MEDIR forca relativa (passo 4 do plano de IA). Coloca UM bot
 * "hard" contra tres "medium" e roda o assento hard por TODAS as cores (cancela a
 * vantagem de ordem). Baseline justo = 25%; acima disso, o nivel dificil e mais
 * forte. Imprime tambem a duracao media (passos) por sanidade.
 */
function playMixed(seed: number, diffOf: (c: PlayerColor) => Difficulty, maxSteps = 30000): { winner: PlayerColor | null; steps: number } {
  let state = createInitialState({ seed });
  let steps = 0;
  while (steps < maxSteps) {
    const move = planBotAction(state, () => true, diffOf);
    if (!move) break;
    const r = reduce(state, move.by, move.action);
    if (!r.ok) throw new Error(`acao ilegal: ${r.error} (${JSON.stringify(move.action)})`);
    state = r.state;
    steps++;
    if (state.phase === 'ended') break;
  }
  return { winner: state.winner, steps };
}

describe('self-play: 1 dificil vs 3 medios', () => {
  it('mede o win-rate do nivel dificil (baseline justo 25%)', () => {
    const N = 40; // seeds
    const seats = PLAYER_COLORS.slice(0, 4); // a partida default tem 4 jogadores
    let hardWins = 0;
    let decided = 0;
    let totalSteps = 0;
    for (let s = 0; s < N; s++) {
      for (const hardSeat of seats) {
        const diffOf = (c: PlayerColor): Difficulty => (c === hardSeat ? 'hard' : 'medium');
        const { winner, steps } = playMixed(s * 13 + 1, diffOf);
        if (!winner) continue;
        decided++;
        totalSteps += steps;
        if (winner === hardSeat) hardWins++;
      }
    }
    const rate = hardWins / decided;
    // eslint-disable-next-line no-console
    console.log(`\n[self-play] decididas: ${decided} | hard venceu ${hardWins} (${(rate * 100).toFixed(1)}%) vs baseline 25% | passos medios ${(totalSteps / decided).toFixed(0)}\n`);
    expect(decided).toBeGreaterThan(N * seats.length * 0.8);
    // Seeds fixos + bot deterministico => taxa reproduzivel (~28.7% hoje). O nivel
    // dificil deve ganhar acima da fatia justa de 25% contra tres medios. Guarda
    // contra regressao (uma versao 1-ply pura ficou em 21.7%, abaixo do baseline).
    expect(rate).toBeGreaterThan(0.26);
  }, 180000);
});
