import { describe, expect, it } from 'vitest';
import { createInitialState, reduce, type GameState, type PlayerColor } from '@trevalis/engine';
import { planBotAction, type Difficulty } from '../src/index.js';

declare const console: { log: (...args: unknown[]) => void };

/** Roda uma partida de NAVEGADORES só de bots até o fim (ou o limite de passos). */
function playSea(seed: number, diffOf: (c: PlayerColor) => Difficulty, maxSteps = 40000): { state: GameState; steps: number } {
  let state = createInitialState({ expansion: 'sea', seed, numberLayout: 'balanced' });
  let steps = 0;
  while (steps < maxSteps && state.phase !== 'ended') {
    const move = planBotAction(state, () => true, diffOf);
    if (!move) break;
    const r = reduce(state, move.by, move.action);
    if (!r.ok) throw new Error(`ação ilegal em Navegadores: ${r.error} (${JSON.stringify(move.action)})`);
    state = r.state;
    steps++;
  }
  return { state, steps };
}

describe('self-play: Navegadores (4 bots)', () => {
  it('termina todas as partidas sem travar e usa navios/ilhas', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const diffOf = (c: PlayerColor): Difficulty => (c === 'red' ? 'hard' : 'medium');
    let finished = 0;
    let totalShips = 0;
    let totalIslands = 0;
    let totalSteps = 0;
    for (const seed of seeds) {
      const { state, steps } = playSea(seed, diffOf);
      totalSteps += steps;
      if (state.phase === 'ended' && state.winner) finished++;
      totalShips += Object.keys(state.ships ?? {}).length;
      totalIslands += state.players.reduce((s, p) => s + (p.islandsScored?.length ?? 0), 0);
    }
    // eslint-disable-next-line no-console
    console.log(`\n[sea self-play] terminadas ${finished}/${seeds.length} | navios ${totalShips} | ilhas colonizadas ${totalIslands} | passos médios ${(totalSteps / seeds.length).toFixed(0)}\n`);
    // Toda partida chega ao fim (nenhuma trava por navio/ouro/pirata/ilha).
    expect(finished).toBe(seeds.length);
    // O bot realmente usa o mar: constrói navios e coloniza ilhas ao longo dos jogos.
    expect(totalShips).toBeGreaterThan(0);
    expect(totalIslands).toBeGreaterThan(0);
  }, 180000);
});
