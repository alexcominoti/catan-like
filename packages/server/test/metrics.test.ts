import { describe, expect, it } from 'vitest';
import type { PlayerColor } from '@trevalis/engine';
import type { Difficulty } from '@trevalis/bot';
import { RoomManager } from '../src/room.js';
import type { RoomConfig } from '../src/protocol.js';
import { metricsSnapshot, recordBotMove, type RoomStats } from '../src/metrics.js';

function makeConfig(humans: PlayerColor[] = []): RoomConfig {
  const all: PlayerColor[] = ['red', 'blue', 'white', 'orange'];
  const bots = all.filter((c) => !humans.includes(c));
  const botDifficulty = Object.fromEntries(all.map((c) => [c, 'medium'])) as Record<PlayerColor, Difficulty>;
  return {
    seed: 7,
    boardLayout: 'standard',
    pace: 'normal',
    players: all.map((c, i) => ({ color: c, name: `P${i + 1}`, ...(humans.includes(c) ? { userId: `u-${c}` } : {}) })),
    bots,
    botDifficulty,
    numberLayout: 'balanced',
    desert: 'random',
    pointsToWin: 10,
    discardLimit: 7,
    friendlyRobber: false,
    balancedDice: false,
  };
}

describe('metrics', () => {
  it('metricsSnapshot: formato + percentis do compute de bot', () => {
    for (const ms of [10, 20, 30, 40, 100]) recordBotMove(ms);
    const rooms: RoomStats = { rooms: 2, games: 1, inProgress: 1, connections: 3, seatedHumans: 2, botsAI: 2 };
    const snap = metricsSnapshot(rooms);
    expect(snap.rooms).toEqual(rooms);
    expect(snap.botMoves.total).toBeGreaterThanOrEqual(5);
    expect(snap.botMoves.p95Ms).toBeGreaterThan(0);
    expect(Number.isFinite(snap.eventLoopMs.mean)).toBe(true); // nunca NaN no JSON
    expect(snap.memoryMb.rss).toBeGreaterThan(0);
    expect(snap.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('RoomManager.stats(): salas, partida em andamento, bots e conexões', () => {
    const m = new RoomManager();
    m.getOrCreate('EMPTY'); // sala sem jogo
    m.startGame('GAME', makeConfig(['red'])); // 1 humano + 3 bots → em andamento
    m.get('GAME')!.connect('u-red', 'c1'); // 1 conexão WS

    const s = m.stats();
    expect(s.rooms).toBe(2);
    expect(s.games).toBe(1);
    expect(s.inProgress).toBe(1);
    expect(s.botsAI).toBe(3);
    expect(s.seatedHumans).toBe(1);
    expect(s.connections).toBe(1);
  });
});
