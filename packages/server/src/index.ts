import { WebSocketServer, type WebSocket } from 'ws';
import type { PlayerColor } from '@hexgame/engine';
import { RoomManager, type GameRoom } from './room.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

/**
 * Camada de transporte (WebSocket) sobre as salas autoritativas. So roteia
 * mensagens: a logica e regras vivem em GameRoom (que usa o motor puro).
 *
 * Rodar: `npm run server` (na raiz) ou `npm start -w @hexgame/server`.
 */
const PORT = Number(process.env.PORT ?? 8080);
const manager = new RoomManager();
const sockets = new Map<string, WebSocket>(); // clientId -> socket

interface Conn {
  clientId: string;
  roomId?: string;
  color?: PlayerColor;
}

const wss = new WebSocketServer({ port: PORT });
// eslint-disable-next-line no-console
console.log(`[hexgame] servidor WebSocket ouvindo em ws://localhost:${PORT}`);

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
    if (conn.roomId) manager.get(conn.roomId)?.unseat(conn.clientId);
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
      broadcast(room);
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
  broadcast(room);
}

function makeClientId(): string {
  return Math.random().toString(36).slice(2, 12);
}
