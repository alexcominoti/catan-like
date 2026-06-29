import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { PlayerColor } from '@trevalis/engine';
import { RoomManager, type GameRoom } from './room.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

/** Caminho do WebSocket quando anexado ao servidor HTTP unico (producao). */
export const WS_PATH = '/ws';

/**
 * Liga toda a logica de salas a um WebSocketServer ja criado. So roteia
 * mensagens — as regras vivem em GameRoom (motor puro).
 */
function wireGameServer(wss: WebSocketServer): WebSocketServer {
  const manager = new RoomManager();
  const sockets = new Map<string, WebSocket>(); // clientId -> socket
  const timers = new Map<string, ReturnType<typeof setTimeout>>(); // roomId -> timer de acao

  interface Conn {
    clientId: string;
    roomId?: string;
    color?: PlayerColor;
  }

  wss.on('connection', (ws) => {
    const conn: Conn = { clientId: makeClientId() };
    sockets.set(conn.clientId, ws);

    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return;
      }
      handle(ws, conn, msg);
    });

    ws.on('close', () => {
      sockets.delete(conn.clientId);
      if (conn.roomId) {
        const room = manager.get(conn.roomId);
        if (room) {
          room.unseat(conn.clientId); // a vaga vira bot medio e assume
          broadcastAndSchedule(room);
        }
      }
    });
  });

  function send(ws: WebSocket, m: ServerMessage): void {
    ws.send(JSON.stringify(m));
  }

  /** Envia a cada humano conectado o estado JA projetado (fog of war) para a cor dele. */
  function broadcast(room: GameRoom): void {
    for (const h of room.humans) {
      if (!h.clientId) continue;
      const ws = sockets.get(h.clientId);
      if (ws) send(ws, { t: 'state', state: room.projectedFor(h.color) });
    }
  }

  /** Reprograma o timer de acao da sala: ao estourar, auto-resolve e re-emite. */
  function scheduleTimer(room: GameRoom): void {
    const prev = timers.get(room.id);
    if (prev) {
      clearTimeout(prev);
      timers.delete(room.id);
    }
    const secs = room.deadlineSeconds();
    if (secs == null) return;
    timers.set(
      room.id,
      setTimeout(() => {
        timers.delete(room.id);
        room.forceTimeout();
        broadcastAndSchedule(room);
      }, secs * 1000),
    );
  }

  function broadcastAndSchedule(room: GameRoom): void {
    broadcast(room);
    scheduleTimer(room);
  }

  function handle(ws: WebSocket, conn: Conn, msg: ClientMessage): void {
    switch (msg.t) {
      case 'create': {
        joinRoom(ws, conn, manager.create(msg.config));
        break;
      }
      case 'join': {
        const room = manager.get(msg.roomId);
        if (!room) {
          send(ws, { t: 'error', error: 'Sala não encontrada.' });
          return;
        }
        joinRoom(ws, conn, room);
        break;
      }
      case 'action': {
        if (!conn.roomId || !conn.color) {
          send(ws, { t: 'error', error: 'Você não está numa sala.' });
          return;
        }
        const room = manager.get(conn.roomId);
        if (!room) return;
        const res = room.apply(conn.color, msg.action);
        if (!res.ok) {
          send(ws, { t: 'error', error: res.error ?? 'Ação inválida.' });
          return;
        }
        broadcastAndSchedule(room);
        break;
      }
    }
  }

  function joinRoom(ws: WebSocket, conn: Conn, room: GameRoom): void {
    const color = room.seat(conn.clientId);
    if (!color) {
      send(ws, { t: 'error', error: 'Sala cheia.' });
      return;
    }
    conn.roomId = room.id;
    conn.color = color;
    send(ws, { t: 'joined', roomId: room.id, color });
    broadcastAndSchedule(room);
  }

  return wss;
}

/**
 * Sobe um servidor WebSocket autonomo na porta dada (`port = 0` deixa o SO
 * escolher — util em testes). Use para rodar SO o jogo, sem HTTP.
 */
export function startServer(port = Number(process.env.PORT ?? 8080)): WebSocketServer {
  return wireGameServer(new WebSocketServer({ port }));
}

/**
 * Anexa o servidor de jogo a um servidor HTTP existente (mesma porta, em
 * `WS_PATH`). E assim que rodamos em producao: HTTP (auth/API/SPA) + WS juntos.
 */
export function attachGameServer(httpServer: HttpServer): WebSocketServer {
  return wireGameServer(new WebSocketServer({ server: httpServer, path: WS_PATH }));
}

function makeClientId(): string {
  return Math.random().toString(36).slice(2, 12);
}
