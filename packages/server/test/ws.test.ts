import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import type { PlayerColor } from '@hexgame/engine';
import type { Difficulty } from '@hexgame/bot';
import { startServer } from '../src/server.js';
import type { RoomConfig, ServerMessage } from '../src/protocol.js';

function config(): RoomConfig {
  const all: PlayerColor[] = ['red', 'blue', 'white', 'orange'];
  const botDifficulty = Object.fromEntries(all.map((c) => [c, 'medium'])) as Record<PlayerColor, Difficulty>;
  return {
    seed: 42,
    boardLayout: 'standard',
    players: all.map((c, i) => ({ color: c, name: `P${i + 1}` })),
    bots: ['blue', 'white', 'orange'], // red = humano (o criador)
    botDifficulty,
    numberLayout: 'balanced',
    desert: 'random',
    pointsToWin: 10,
    discardLimit: 7,
    friendlyRobber: false,
  };
}

describe('servidor WebSocket (ponta a ponta)', () => {
  let wss: WebSocketServer;
  let port: number;

  beforeAll(async () => {
    wss = startServer(0);
    await new Promise<void>((res) => wss.on('listening', () => res()));
    const addr = wss.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(() => {
    wss.close();
  });

  it('cria sala, recebe joined + estado projetado e aplica uma acao', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const inbox: ServerMessage[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(String(d)) as ServerMessage));

    const next = (pred: (m: ServerMessage) => boolean, timeout = 4000): Promise<ServerMessage> =>
      new Promise((resolve, reject) => {
        const t = setInterval(() => {
          const m = inbox.find(pred);
          if (m) {
            clearInterval(t);
            resolve(m);
          }
        }, 10);
        setTimeout(() => {
          clearInterval(t);
          reject(new Error('timeout esperando mensagem'));
        }, timeout);
      });

    await new Promise<void>((res) => ws.on('open', () => res()));
    ws.send(JSON.stringify({ t: 'create', config: config(), name: 'Você' }));

    const joined = await next((m) => m.t === 'joined');
    expect(joined.t === 'joined' && joined.color).toBe('red');

    const first = (await next((m) => m.t === 'state')) as Extract<ServerMessage, { t: 'state' }>;
    // Fog of war: a mao de um adversario vem oculta (hiddenHand definido).
    const opp = first.state.players.find((p) => p.color !== 'red')!;
    expect(typeof opp.hiddenHand).toBe('number');
    expect(first.state.rng.seed).toBe(0);

    // Aplica a vila inicial num vertice valido e espera o novo estado.
    const vid = first.state.board.vertexOrder[0]!;
    inbox.length = 0;
    ws.send(JSON.stringify({ t: 'action', action: { t: 'placeSettlement', vertexId: vid } }));
    const after = (await next((m) => m.t === 'state')) as Extract<ServerMessage, { t: 'state' }>;
    expect(after.state.buildings[vid]?.owner).toBe('red');

    ws.close();
  });
});
