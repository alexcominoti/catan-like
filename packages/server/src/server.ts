import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { fromNodeHeaders } from 'better-auth/node';
import { getAuth } from './auth.js';
import { getRoom, finishRoom } from './rooms.js';
import { EMPTY_ROOM_TTL_MS, RECONNECT_GRACE_MS, RoomManager, type LiveRoom } from './room.js';
import { presence } from './presence.js';
import { summarizeMatch, type MatchSummary } from './match.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

/** Caminho do WebSocket quando anexado ao servidor HTTP unico (producao). */
export const WS_PATH = '/ws';

/** A cada quanto tempo o servidor varre salas vazias (item 6). */
const SWEEP_INTERVAL_MS = 30_000;
/** Heartbeat ws (ping/pong): detecta quedas "silenciosas" (sem `close` limpo). */
const HEARTBEAT_INTERVAL_MS = 10_000;

export interface GameServerDeps {
  /** Compartilhado com a camada HTTP (rota `/start` chama `manager.startGame`). */
  manager?: RoomManager;
  /** Resolve o userId autenticado pelo cookie da conexao (null = anonimo/sem sessao). */
  resolveUserId?: (req: IncomingMessage) => Promise<string | null>;
  /** A sala existe nos metadados (banco)? So usada para validar um `code` desconhecido. */
  roomExists?: (code: string) => Promise<boolean>;
  /** Chamado quando uma partida termina (persistir status 'finished' + gravar histórico/stats). */
  onGameEnded?: (code: string, summary: MatchSummary) => Promise<void>;
  /** Chamado quando uma sala fica vazia por >= EMPTY_ROOM_TTL_MS (persistir/limpar). */
  onRoomExpired?: (code: string) => Promise<void>;
  /** Limpeza periódica das salas 'waiting' inativas no banco (item 6). */
  onSweepStaleRooms?: () => Promise<string[]>;
}

async function defaultResolveUserId(req: IncomingMessage): Promise<string | null> {
  const auth = getAuth();
  if (!auth) return null;
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return session?.user.id ?? null;
}

async function defaultRoomExists(code: string): Promise<boolean> {
  if (!getAuth()) return false;
  return (await getRoom(code)) != null;
}

/**
 * Liga toda a logica de salas a um WebSocketServer ja criado. So roteia
 * mensagens/presenca — as regras do jogo vivem em GameRoom (motor puro); a
 * presenca/reconexao/graca vive em LiveRoom (room.ts).
 */
function wireGameServer(wss: WebSocketServer, deps: GameServerDeps = {}): WebSocketServer {
  const manager = deps.manager ?? new RoomManager();
  const resolveUserId = deps.resolveUserId ?? defaultResolveUserId;
  const roomExists = deps.roomExists ?? defaultRoomExists;
  // Fim de partida (padrão): marca a sala 'finished' E grava o histórico/stats
  // (match/match_player/player_stats). Best-effort — uma falha de persistência
  // (ex.: sem banco) não pode derrubar a partida em memória.
  const onGameEnded = deps.onGameEnded ?? (async (code: string, summary: MatchSummary) => {
    try {
      await finishRoom(code);
      const { persistMatch } = await import('./match.js');
      await persistMatch(code, summary);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[trevalis][match] falha ao gravar a partida encerrada:', err);
    }
  });
  const onRoomExpired = deps.onRoomExpired ?? (async (code: string) => {
    const { abandonIfNotFinished } = await import('./rooms.js');
    await abandonIfNotFinished(code);
  });
  const onSweepStaleRooms = deps.onSweepStaleRooms ?? (async () => {
    const { sweepStaleWaitingRooms } = await import('./rooms.js');
    return sweepStaleWaitingRooms();
  });

  const sockets = new Map<string, WebSocket>(); // connId -> socket
  const timers = new Map<string, ReturnType<typeof setTimeout>>(); // code -> timer de acao da partida

  interface Conn {
    connId: string;
    userIdPromise: Promise<string | null>;
    userId?: string | null;
    code?: string;
  }
  const conns = new Map<WebSocket, Conn>();

  wss.on('connection', (ws, req) => {
    const conn: Conn = { connId: makeId(), userIdPromise: resolveUserId(req) };
    void conn.userIdPromise.then((uid) => {
      conn.userId = uid;
    });
    conns.set(ws, conn);
    sockets.set(conn.connId, ws);
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on('pong', () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return;
      }
      void handle(ws, conn, msg);
    });

    ws.on('close', () => {
      sockets.delete(conn.connId);
      conns.delete(ws);
      if (conn.code && conn.userId) leaveRoom(conn.code, conn.userId, conn.connId);
    });
  });

  // Heartbeat: sem pong desde o ultimo ping, encerra a conexao (dispara 'close' -> graca).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const alive = (ws as WebSocket & { isAlive?: boolean }).isAlive;
      if (alive === false) {
        ws.terminate();
        continue;
      }
      (ws as WebSocket & { isAlive?: boolean }).isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  wss.on('close', () => clearInterval(heartbeat));

  // Limpeza de sala vazia (item 6): a cada SWEEP_INTERVAL_MS varre tanto as salas
  // AO VIVO sem ninguém (in_progress abandonadas, via presença em memória) quanto
  // as salas de espera inativas no BANCO (waiting expiradas, que nunca abrem WS).
  const sweeper = setInterval(() => {
    manager.sweep(EMPTY_ROOM_TTL_MS, (code) => {
      manager.remove(code);
      void onRoomExpired(code);
    });
    void onSweepStaleRooms().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[trevalis][sweep] falha ao limpar salas inativas:', err);
    });
  }, SWEEP_INTERVAL_MS);
  wss.on('close', () => clearInterval(sweeper));

  function send(ws: WebSocket, m: ServerMessage): void {
    ws.send(JSON.stringify(m));
  }

  /** Envia a cada conectado (jogador OU espectador) o estado ja projetado para ele. */
  function broadcast(code: string, live: LiveRoom): void {
    const room = live.gameRoom;
    if (!room) return;
    const awayColors = room.awayColors();
    const deadlineSeconds = room.deadlineSeconds();
    const events = room.drainEvents(); // uma vez so: todos os conectados recebem os mesmos eventos
    for (const userId of live.connectedUserIds()) {
      const connId = live.connIdOf(userId);
      const ws = connId ? sockets.get(connId) : undefined;
      if (!ws) continue;
      const color = room.colorOf(userId);
      send(ws, { t: 'state', state: room.projectedFor(color), awayColors, deadlineSeconds, events });
    }
    if (room.state.phase === 'ended' && !live.finishNotified) {
      live.finishNotified = true;
      const cfg = room.config;
      const summary = summarizeMatch(room.state, room.humans, awayColors, {
        seed: cfg.seed,
        boardLayout: cfg.boardLayout,
        pace: cfg.pace,
        pointsToWin: cfg.pointsToWin,
      });
      void onGameEnded(code, summary);
    }
  }

  /** Reprograma o timer de acao da sala: ao estourar, auto-resolve e re-emite. */
  function scheduleTimer(code: string, live: LiveRoom): void {
    const prev = timers.get(code);
    if (prev) {
      clearTimeout(prev);
      timers.delete(code);
    }
    const secs = live.gameRoom?.deadlineSeconds();
    if (secs == null) return;
    timers.set(
      code,
      setTimeout(() => {
        timers.delete(code);
        live.gameRoom?.forceTimeout();
        broadcastAndSchedule(code, live);
      }, secs * 1000),
    );
  }

  function broadcastAndSchedule(code: string, live: LiveRoom): void {
    broadcast(code, live);
    scheduleTimer(code, live);
  }

  function leaveRoom(code: string, userId: string, connId: string): void {
    const live = manager.get(code);
    if (!live) return;
    live.disconnect(userId, connId, RECONNECT_GRACE_MS, () => broadcastAndSchedule(code, live));
  }

  async function handle(ws: WebSocket, conn: Conn, msg: ClientMessage): Promise<void> {
    const userId = conn.userId !== undefined ? conn.userId : await conn.userIdPromise;
    if (!userId) {
      send(ws, { t: 'error', error: 'Você precisa entrar para acessar uma sala.' });
      return;
    }
    // Presença: quem está ativo numa sala conta como online (a sala vem do WS;
    // o heartbeat HTTP global cobre lobby/landing). Ver presence.ts.
    presence.touch(userId, msg.t === 'enter' ? msg.code.toUpperCase() : conn.code ?? null);

    switch (msg.t) {
      case 'enter': {
        const code = msg.code.toUpperCase();
        if (conn.code && conn.code !== code) leaveRoom(conn.code, userId, conn.connId);

        if (!(await roomExists(code))) {
          send(ws, { t: 'error', error: 'Sala não encontrada.' });
          return;
        }
        conn.code = code;
        const live = manager.getOrCreate(code);
        const color = live.connect(userId, conn.connId);
        send(ws, { t: 'joined', code, color, bots: live.gameRoom?.config.bots ?? [] });
        if (live.gameRoom) {
          const room = live.gameRoom;
          send(ws, {
            t: 'state',
            state: room.projectedFor(color),
            awayColors: room.awayColors(),
            deadlineSeconds: room.deadlineSeconds(),
            events: [], // instantaneo inicial: sem "delta" para tocar som/log
          });
          scheduleTimer(code, live);
        }
        break;
      }
      case 'action': {
        if (!conn.code) {
          send(ws, { t: 'error', error: 'Você não está numa sala.' });
          return;
        }
        const live = manager.get(conn.code);
        const room = live?.gameRoom;
        const color = room?.colorOf(userId) ?? null;
        if (!room || !color) {
          send(ws, { t: 'error', error: 'Você não está numa sala.' });
          return;
        }
        const res = room.apply(color, msg.action);
        if (!res.ok) {
          send(ws, { t: 'error', error: res.error ?? 'Ação inválida.' });
          return;
        }
        broadcastAndSchedule(conn.code, live!);
        break;
      }
      case 'select': {
        // Seleção tentativa (ex.: descarte já escolhido): só guarda no servidor
        // para usar no timeout — não valida agora nem faz broadcast.
        if (!conn.code) return;
        const room = manager.get(conn.code)?.gameRoom;
        const color = room?.colorOf(userId) ?? null;
        if (room && color) room.setPendingSelection(color, msg.action);
        break;
      }
    }
  }

  return wss;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 12);
}

/**
 * Sobe um servidor WebSocket autonomo na porta dada (`port = 0` deixa o SO
 * escolher — util em testes). Use para rodar SO o jogo, sem HTTP.
 */
export function startServer(port = Number(process.env.PORT ?? 8080), deps?: GameServerDeps): WebSocketServer {
  return wireGameServer(new WebSocketServer({ port }), deps);
}

/**
 * Anexa o servidor de jogo a um servidor HTTP existente (mesma porta, em
 * `WS_PATH`). E assim que rodamos em producao: HTTP (auth/API/SPA) + WS juntos.
 */
export function attachGameServer(httpServer: HttpServer, deps?: GameServerDeps): WebSocketServer {
  return wireGameServer(new WebSocketServer({ server: httpServer, path: WS_PATH }), deps);
}

// Reexportado para quem precisa criar o RoomManager compartilhado com o HTTP (index.ts).
export { RoomManager } from './room.js';
