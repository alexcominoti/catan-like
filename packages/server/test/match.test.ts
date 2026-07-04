import { describe, expect, it } from 'vitest';
import type { GameState, PlayerColor } from '@trevalis/engine';
import {
  applyStatsDelta,
  summarizeMatch,
  ZERO_STATS,
  type HumanSeat,
} from '../src/match.js';

/**
 * Estado mínimo p/ o núcleo de resumo: só os campos que `scoreOf` lê (jogadores
 * com progressCards, buildings, longestRoad/largestArmy). Assim a pontuação é
 * previsível sem simular uma partida inteira.
 */
function endedState(winner: PlayerColor): GameState {
  return {
    winner,
    players: [
      { color: 'red', progressCards: ['victoryPoint'] },
      { color: 'blue', progressCards: [] },
      { color: 'white', progressCards: [] },
    ],
    buildings: {
      v1: { kind: 'city', owner: 'red', vertexId: 'v1' }, // +2
      v2: { kind: 'settlement', owner: 'blue', vertexId: 'v2' }, // +1
    },
    longestRoad: { owner: 'red', length: 5 }, // red +2
    largestArmy: { owner: null, size: 0 },
  } as unknown as GameState;
}

const CONFIG = { seed: 42, boardLayout: 'standard', pace: 'normal', pointsToWin: 10 };

describe('summarizeMatch', () => {
  it('resume só os humanos, com pontos reais e o vencedor certo', () => {
    const humans: HumanSeat[] = [
      { color: 'red', name: 'Ana', userId: 'u-red' },
      { color: 'blue', name: 'Beto', userId: 'u-blue' },
      // white é bot: não entra em humans.
    ];
    const s = summarizeMatch(endedState('red'), humans, [], CONFIG);

    expect(s.seed).toBe(42);
    expect(s.winnerUserId).toBe('u-red');
    expect(s.config).toEqual({ boardLayout: 'standard', pace: 'normal', pointsToWin: 10 });
    expect(s.players).toEqual([
      { userId: 'u-red', color: 'red', points: 5, won: true, abandoned: false }, // 2 (cidade) +2 (estrada) +1 (carta PV)
      { userId: 'u-blue', color: 'blue', points: 1, won: false, abandoned: false },
    ]);
  });

  it('marca como abandonada a vaga que virou bot (awayColors)', () => {
    const humans: HumanSeat[] = [
      { color: 'red', name: 'Ana', userId: 'u-red' },
      { color: 'blue', name: 'Beto', userId: 'u-blue' },
    ];
    const s = summarizeMatch(endedState('red'), humans, ['blue'], CONFIG);
    expect(s.players.find((p) => p.color === 'blue')?.abandoned).toBe(true);
    expect(s.players.find((p) => p.color === 'red')?.abandoned).toBe(false);
  });

  it('vencedor bot → nenhum humano venceu (winnerUserId null)', () => {
    const humans: HumanSeat[] = [{ color: 'red', name: 'Ana', userId: 'u-red' }];
    const s = summarizeMatch(endedState('white'), humans, [], CONFIG);
    expect(s.winnerUserId).toBeNull();
    expect(s.players[0]!.won).toBe(false);
  });
});

describe('applyStatsDelta', () => {
  it('vitória: incrementa jogos/vitórias e a sequência (e o recorde acompanha)', () => {
    const a = applyStatsDelta(ZERO_STATS, { won: true, abandoned: false });
    expect(a).toEqual({
      gamesPlayed: 1,
      gamesWon: 1,
      currentStreak: 1,
      longestStreak: 1,
      gamesCompleted: 1,
      gamesAbandoned: 0,
    });
    const b = applyStatsDelta(a, { won: true, abandoned: false });
    expect(b.currentStreak).toBe(2);
    expect(b.longestStreak).toBe(2);
  });

  it('derrota: zera a sequência atual mas preserva o recorde', () => {
    const won2 = applyStatsDelta(applyStatsDelta(ZERO_STATS, { won: true, abandoned: false }), { won: true, abandoned: false });
    const lost = applyStatsDelta(won2, { won: false, abandoned: false });
    expect(lost.currentStreak).toBe(0);
    expect(lost.longestStreak).toBe(2);
    expect(lost.gamesWon).toBe(2);
    expect(lost.gamesPlayed).toBe(3);
  });

  it('abandono conta para o karma (abandoned++) e não para concluídas', () => {
    const a = applyStatsDelta(ZERO_STATS, { won: false, abandoned: true });
    expect(a.gamesAbandoned).toBe(1);
    expect(a.gamesCompleted).toBe(0);
    expect(a.gamesPlayed).toBe(1);
  });
});
