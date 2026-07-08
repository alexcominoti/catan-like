import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { createInitialState, type GameState, type PlayerColor } from '@trevalis/engine';
import type { Difficulty } from '@trevalis/bot';
import { startServer, type GameServerDeps } from '../src/server.js';
import { GameRoom, RoomManager } from '../src/room.js';
import type { RoomConfig, ServerMessage } from '../src/protocol.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Config padrão: red = humano (user-red); blue/white/orange = bots. */
function config(order: PlayerColor[] = ['red', 'blue', 'white', 'orange']): RoomConfig {
  const bots: PlayerColor[] = order.filter((c) => c !== 'red');
  const botDifficulty = Object.fromEntries(order.map((c) => [c, 'medium'])) as Record<PlayerColor, Difficulty>;
  return {
    seed: 42,
    boardLayout: 'standard',
    pace: 'normal',
    players: order.map((c, i) => ({ color: c, name: `P${i + 1}`, ...(c === 'red' ? { userId: 'user-red' } : {}) })),
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

function nextMessage(inbox: ServerMessage[], pred: (m: ServerMessage) => boolean, timeout = 4000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      const m = inbox.find(pred);
      if (m) { clearInterval(t); resolve(m); }
    }, 10);
    setTimeout(() => { clearInterval(t); reject(new Error('timeout esperando mensagem')); }, timeout);
  });
}

const servers: WebSocketServer[] = [];
function makeServer(deps: GameServerDeps): Promise<number> {
  const wss = startServer(0, { resolveUserId: async () => 'user-red', roomExists: async () => true, ...deps });
  servers.push(wss);
  return new Promise((res) => wss.on('listening', () => {
    const addr = wss.address();
    res(typeof addr === 'object' && addr ? addr.port : 0);
  }));
}

async function connectAndEnter(port: number, code: string): Promise<{ ws: WebSocket; inbox: ServerMessage[] }> {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const inbox: ServerMessage[] = [];
  ws.on('message', (d) => inbox.push(JSON.parse(String(d)) as ServerMessage));
  await new Promise<void>((res) => ws.on('open', () => res()));
  ws.send(JSON.stringify({ t: 'enter', code }));
  return { ws, inbox };
}

afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

describe('persistência restart-safe', () => {
  it('GameRoom com restoreState reidrata o estado verbatim e NÃO roda o setup', () => {
    // Ordem com um BOT (blue) primeiro: um jogo novo rodaria o setup dele (runBots).
    const cfg = config(['blue', 'red', 'white', 'orange']);
    const saved = createInitialState({
      seed: 42,
      boardLayout: 'standard',
      players: cfg.players.map((p) => ({ color: p.color, name: p.name })),
      numberLayout: 'balanced',
    });
    expect(saved.currentPlayer).toBe('blue');
    expect(Object.keys(saved.buildings)).toHaveLength(0);

    const restored = new GameRoom('R', cfg, saved);
    // Restaurado: idêntico ao snapshot; o setup do bot NÃO foi jogado.
    expect(restored.state.phase).toBe('setup1');
    expect(restored.state.currentPlayer).toBe('blue');
    expect(Object.keys(restored.state.buildings)).toHaveLength(0);

    // Já um jogo NOVO com a mesma config avança o setup do bot (prova o contraste).
    const fresh = new GameRoom('R', cfg);
    expect(Object.keys(fresh.state.buildings).length).toBeGreaterThan(0);
  });

  it('RoomManager.restoreGame liga o GameRoom com o estado salvo', () => {
    const cfg = config();
    const saved = createInitialState({ seed: 1, players: cfg.players.map((p) => ({ color: p.color, name: p.name })) });
    const mgr = new RoomManager();
    const gr = mgr.restoreGame('R', cfg, saved);
    expect(mgr.get('R')?.gameRoom).toBe(gr);
    expect(gr.state.currentPlayer).toBe(saved.currentPlayer);
  });

  it('após um "restart", entrar na sala RESTAURA a partida do snapshot salvo', async () => {
    // Estado com uma vila do red já colocada (prova que restaurou, não recriou).
    const cfg = config();
    const seed = new GameRoom('R', cfg);
    const vid = seed.state.board.vertexOrder[0]!;
    seed.apply('red', { t: 'placeSettlement', vertexId: vid });
    const savedMid: GameState = JSON.parse(JSON.stringify(seed.state));
    expect(savedMid.buildings[vid]?.owner).toBe('red');

    // Servidor "novo" (manager vazio) que sabe carregar o snapshot dessa sala.
    const port = await makeServer({
      manager: new RoomManager(),
      loadGameForEnter: async () => ({ config: cfg, state: savedMid }),
    });
    const { ws, inbox } = await connectAndEnter(port, 'ROOM01');

    const joined = await nextMessage(inbox, (m) => m.t === 'joined');
    expect(joined.t === 'joined' && joined.color).toBe('red');
    const state = (await nextMessage(inbox, (m) => m.t === 'state')) as Extract<ServerMessage, { t: 'state' }>;
    expect(state.state.buildings[vid]?.owner).toBe('red'); // veio do snapshot restaurado
    ws.close();
  });

  it('sem snapshot (partida recém-iniciada), entrar RECRIA a partida do config', async () => {
    const cfg = config();
    const port = await makeServer({
      manager: new RoomManager(),
      loadGameForEnter: async () => ({ config: cfg }), // sem state
    });
    const { ws, inbox } = await connectAndEnter(port, 'ROOM01');
    const state = (await nextMessage(inbox, (m) => m.t === 'state')) as Extract<ServerMessage, { t: 'state' }>;
    // Jogo novo: fase de setup, sem vila do red ainda.
    expect(state.state.phase).toBe('setup1');
    expect(state.state.currentPlayer).toBe('red');
    ws.close();
  });

  it('o broadcast agenda a gravação do snapshot (debounce) após uma ação', async () => {
    const cfg = config();
    const saves: { code: string; phase: string; buildings: number }[] = [];
    const manager = new RoomManager();
    manager.startGame('ROOM01', cfg); // partida viva (red é o 1º a agir no setup)
    const port = await makeServer({
      manager,
      saveGameSnapshot: async (code, state) => {
        saves.push({ code, phase: state.phase, buildings: Object.keys(state.buildings).length });
      },
    });
    const { ws, inbox } = await connectAndEnter(port, 'ROOM01');
    const first = (await nextMessage(inbox, (m) => m.t === 'state')) as Extract<ServerMessage, { t: 'state' }>;
    const vid = first.state.board.vertexOrder[0]!;
    ws.send(JSON.stringify({ t: 'action', action: { t: 'placeSettlement', vertexId: vid } }));
    await nextMessage(inbox, (m) => m.t === 'state' && Boolean((m as Extract<ServerMessage, { t: 'state' }>).state.buildings[vid]));

    await sleep(1200); // espera o debounce (1s) do snapshot
    expect(saves.length).toBeGreaterThan(0);
    expect(saves[saves.length - 1]!.code).toBe('ROOM01');
    expect(saves[saves.length - 1]!.buildings).toBeGreaterThan(0);
    ws.close();
  });
});
