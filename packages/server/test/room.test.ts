import { describe, expect, it } from 'vitest';
import { RESOURCES, type PlayerColor } from '@hexgame/engine';
import type { Difficulty } from '@hexgame/bot';
import { GameRoom, RoomManager } from '../src/room.js';
import type { RoomConfig } from '../src/protocol.js';

function makeConfig(opts: { seed?: number; humans?: PlayerColor[] } = {}): RoomConfig {
  const all: PlayerColor[] = ['red', 'blue', 'white', 'orange'];
  const humans = opts.humans ?? [];
  const bots = all.filter((c) => !humans.includes(c));
  const botDifficulty = Object.fromEntries(all.map((c) => [c, 'medium'])) as Record<PlayerColor, Difficulty>;
  return {
    seed: opts.seed ?? 7,
    boardLayout: 'standard',
    players: all.map((c, i) => ({ color: c, name: `P${i + 1}` })),
    bots,
    botDifficulty,
    numberLayout: 'balanced',
    desert: 'random',
    pointsToWin: 10,
    discardLimit: 7,
    friendlyRobber: false,
  };
}

describe('GameRoom (servidor autoritativo)', () => {
  it('sala so de bots joga sozinha ate o fim', () => {
    const room = new GameRoom('R1', makeConfig());
    expect(room.state.phase).toBe('ended');
    expect(room.state.winner).not.toBeNull();
  });

  it('com 1 humano, a sala para na vez do humano (setup) e so abre 1 vaga', () => {
    const room = new GameRoom('R2', makeConfig({ humans: ['red'] }));
    expect(room.state.phase).toBe('setup1');
    expect(room.state.currentPlayer).toBe('red');
    expect(room.seat('client-1')).toBe('red');
    expect(room.seat('client-2')).toBeNull(); // so havia 1 assento humano
    expect(room.colorOf('client-1')).toBe('red');
  });

  it('aplica uma acao do humano e segue auto-jogando os bots', () => {
    const room = new GameRoom('R3', makeConfig({ humans: ['red'] }));
    const vid = room.state.board.vertexOrder[0]!;
    const res = room.apply('red', { t: 'placeSettlement', vertexId: vid });
    expect(res.ok).toBe(true);
    // Apos colocar a vila, o engine pede a estrada do mesmo jogador (setup).
    expect(room.state.buildings[vid]?.owner).toBe('red');
  });

  it('rejeita acao ilegal sem mudar o estado', () => {
    const room = new GameRoom('R4', makeConfig({ humans: ['red'] }));
    const before = JSON.stringify(room.state);
    const res = room.apply('red', { t: 'rollDice' }); // nao e fase de rolar
    expect(res.ok).toBe(false);
    expect(JSON.stringify(room.state)).toBe(before);
  });

  it('projeta o estado escondendo a mao dos adversarios', () => {
    const room = new GameRoom('R5', makeConfig());
    const view = room.projectedFor('red');
    const opp = view.players.find((p) => p.color !== 'red')!;
    expect(RESOURCES.every((r) => opp.hand[r] === 0)).toBe(true);
    expect(typeof opp.hiddenHand).toBe('number');
    expect(view.rng.seed).toBe(0);
  });

  it('RoomManager cria salas com ids unicos e as recupera', () => {
    const m = new RoomManager();
    const a = m.create(makeConfig());
    const b = m.create(makeConfig());
    expect(a.id).not.toBe(b.id);
    expect(m.get(a.id)).toBe(a);
  });
});
