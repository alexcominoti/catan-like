import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import type { PlayerColor } from '@trevalis/engine';
import type { Difficulty } from '@trevalis/bot';
import { startServer } from '../src/server.js';
import { RoomManager } from '../src/room.js';
import type { RoomConfig, ServerMessage } from '../src/protocol.js';

const ROOM_CODE = 'ROOM01';

function config(): RoomConfig {
  const all: PlayerColor[] = ['red', 'blue', 'white', 'orange'];
  const botDifficulty = Object.fromEntries(all.map((c) => [c, 'medium'])) as Record<PlayerColor, Difficulty>;
  return {
    seed: 42,
    boardLayout: 'standard',
    pace: 'normal',
    players: all.map((c, i) => ({ color: c, name: `P${i + 1}`, ...(c === 'red' ? { userId: 'user-red' } : {}) })),
    bots: ['blue', 'white', 'orange'], // red = humano (o criador)
    botDifficulty,
    numberLayout: 'balanced',
    desert: 'random',
    pointsToWin: 10,
    discardLimit: 7,
    friendlyRobber: false,
  };
}

function nextMessage(inbox: ServerMessage[], pred: (m: ServerMessage) => boolean, timeout = 4000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
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
}

/** Conecta, autentica como `userId` (via resolveUserId injetado) e entra na sala. */
async function connectAndEnter(port: number, code: string): Promise<{ ws: WebSocket; inbox: ServerMessage[] }> {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const inbox: ServerMessage[] = [];
  ws.on('message', (d) => inbox.push(JSON.parse(String(d)) as ServerMessage));
  await new Promise<void>((res) => ws.on('open', () => res()));
  ws.send(JSON.stringify({ t: 'enter', code }));
  return { ws, inbox };
}

describe('servidor WebSocket (ponta a ponta)', () => {
  let wss: WebSocketServer;
  let port: number;
  let manager: RoomManager;

  beforeAll(async () => {
    manager = new RoomManager();
    manager.startGame(ROOM_CODE, config());
    wss = startServer(0, {
      manager,
      resolveUserId: async () => 'user-red',
      roomExists: async (code) => code === ROOM_CODE,
    });
    await new Promise<void>((res) => wss.on('listening', () => res()));
    const addr = wss.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(() => {
    wss.close();
  });

  it('entra na sala, recebe joined + estado projetado e aplica uma acao', async () => {
    const { ws, inbox } = await connectAndEnter(port, ROOM_CODE);

    const joined = await nextMessage(inbox, (m) => m.t === 'joined');
    expect(joined.t === 'joined' && joined.color).toBe('red');

    const first = (await nextMessage(inbox, (m) => m.t === 'state')) as Extract<ServerMessage, { t: 'state' }>;
    // Fog of war: a mao de um adversario vem oculta (hiddenHand definido).
    const opp = first.state.players.find((p) => p.color !== 'red')!;
    expect(typeof opp.hiddenHand).toBe('number');
    expect(first.state.rng.seed).toBe(0);
    expect(first.awayColors).toEqual([]);

    // Aplica a vila inicial num vertice valido e espera o novo estado.
    const vid = first.state.board.vertexOrder[0]!;
    inbox.length = 0;
    ws.send(JSON.stringify({ t: 'action', action: { t: 'placeSettlement', vertexId: vid } }));
    const after = (await nextMessage(inbox, (m) => m.t === 'state')) as Extract<ServerMessage, { t: 'state' }>;
    expect(after.state.buildings[vid]?.owner).toBe('red');

    ws.close();
  });

  it('sala inexistente responde com erro', async () => {
    const { inbox } = await connectAndEnter(port, 'NAOEXISTE');
    const err = await nextMessage(inbox, (m) => m.t === 'error');
    expect(err.t === 'error' && err.error).toMatch(/não encontrada/);
  });
});
