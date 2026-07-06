/**
 * Camada HTTP do servidor unico (producao): serve a SPA buildada, as rotas de
 * autenticacao (`/api/auth/*` via Better Auth), `/api/me`, `/healthz` e um
 * fallback de SPA. O WebSocket do jogo e anexado a ESTE mesmo servidor
 * (mesma porta/origem), o que mantem cookies e CSRF simples.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { eq, sql } from 'drizzle-orm';
import { getDb, user as userTable } from '@trevalis/db';
import { getAuth, isUsernameTaken } from './auth.js';
import { validateUsername } from './username.js';
import {
  addBot,
  buildRoomConfig,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  listFriendRooms,
  listOpenRooms,
  listRejoinableRooms,
  removeBot,
  startRoom,
  touchRoomActivity,
  updateBot,
  updateRoomSettings,
} from './rooms.js';
import { getProfileStats, getPublicProfileByUsername } from './stats.js';
import { presence } from './presence.js';
import {
  acceptFriendRequest,
  blockUser,
  listFriends,
  removeFriend,
  sendFriendRequest,
  unblockUser,
} from './friends.js';
import { joinQuickMatch, leaveQuickMatch, matchmakingStatus } from './matchmaking.js';
import { invites } from './invites.js';
import { reportUser } from './reports.js';
import type { RoomManager } from './room.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Diretorio com a SPA buildada (apps/web/dist). Configuravel via WEB_DIST. */
const WEB_DIST =
  process.env.WEB_DIST ?? join(__dirname, '..', '..', '..', 'apps', 'web', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(data);
}

/** Lê e faz parse do corpo JSON de uma requisição (limite simples de tamanho). */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error('Corpo da requisição muito grande.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Resolve o usuário autenticado da requisição, ou responde (503/401) e retorna
 * null. Centraliza a checagem usada pelas rotas que exigem login (perfil, salas).
 */
async function authedUser(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ id: string } | null> {
  const auth = getAuth();
  if (!auth) {
    sendJson(res, 503, { error: 'Autenticacao indisponivel (sem banco configurado).' });
    return null;
  }
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) {
    sendJson(res, 401, { error: 'Você precisa entrar para acessar uma sala.' });
    return null;
  }
  return session.user;
}

/** Serve um arquivo estatico; retorna false se nao existir. */
async function serveFile(res: ServerResponse, filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const buf = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const immutable = filePath.includes(`${join('assets')}`) || /\.[0-9a-f]{8,}\./.test(filePath);
    res.writeHead(200, {
      'content-type': type,
      'cache-control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    res.end(buf);
    return true;
  } catch {
    return false;
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  manager: RoomManager,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  // --- health check (usado pelo Fly) ---
  if (path === '/healthz' || path === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'trevalis' });
    return;
  }

  // --- autenticacao (Better Auth) ---
  if (path.startsWith('/api/auth')) {
    const auth = getAuth();
    if (!auth) {
      sendJson(res, 503, { error: 'Autenticacao indisponivel (sem banco configurado).' });
      return;
    }
    return toNodeHandler(auth)(req, res);
  }

  // --- perfil do usuario logado ---
  if (path === '/api/me') {
    const auth = getAuth();
    if (!auth) {
      sendJson(res, 503, { error: 'Autenticacao indisponivel.' });
      return;
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      sendJson(res, 401, { error: 'Nao autenticado.' });
      return;
    }
    const u = session.user as typeof session.user & {
      username?: string | null;
      usernameChanged?: boolean | null;
    };
    sendJson(res, 200, {
      id: u.id,
      name: u.name,
      email: u.email,
      username: u.username ?? null,
      usernameChanged: u.usernameChanged ?? false,
      avatar: u.image ?? null,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
    });
    return;
  }

  // --- troca (única) de username pelo usuário logado ---
  if (path === '/api/profile/username' && req.method === 'POST') {
    const auth = getAuth();
    if (!auth) {
      sendJson(res, 503, { error: 'Autenticacao indisponivel.' });
      return;
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      sendJson(res, 401, { error: 'Nao autenticado.' });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Corpo inválido.' });
      return;
    }
    const raw = (body as { username?: unknown }).username;
    const name = typeof raw === 'string' ? raw.trim() : '';
    const err = validateUsername(name);
    if (err) {
      sendJson(res, 400, { error: err });
      return;
    }
    const db = getDb();
    const userId = session.user.id;
    // Cota: o usuário só pode trocar o nome UMA vez.
    const [current] = await db
      .select({ usernameChanged: userTable.usernameChanged })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (current?.usernameChanged) {
      sendJson(res, 409, { error: 'Você já alterou seu nome de usuário.' });
      return;
    }
    if (await isUsernameTaken(name, userId)) {
      sendJson(res, 409, { error: 'Esse nome de usuário já está em uso.' });
      return;
    }
    await db
      .update(userTable)
      .set({ username: name, name, usernameChanged: true, updatedAt: new Date() })
      .where(eq(userTable.id, userId));
    sendJson(res, 200, { username: name, usernameChanged: true });
    return;
  }

  // --- estatísticas do perfil (dados reais; vazio se não há partidas) ---
  if (path === '/api/profile/stats' && req.method === 'GET') {
    const u = await authedUser(req, res);
    if (!u) return;
    sendJson(res, 200, await getProfileStats(u.id));
    return;
  }

  // --- perfil PÚBLICO por username (compartilhável via /profile/:username) ---
  const profileMatch = /^\/api\/profile\/by-username\/([^/]+)$/.exec(path);
  if (profileMatch && req.method === 'GET') {
    if (!getAuth()) {
      sendJson(res, 503, { error: 'Perfil indisponivel (sem banco configurado).' });
      return;
    }
    const profile = await getPublicProfileByUsername(decodeURIComponent(profileMatch[1]!));
    if (!profile) {
      sendJson(res, 404, { error: 'Usuário não encontrado.' });
      return;
    }
    sendJson(res, 200, profile);
    return;
  }

  // --- presença: contador público de jogadores online (landing) ---
  if (path === '/api/presence' && req.method === 'GET') {
    sendJson(res, 200, { online: presence.count() });
    return;
  }

  // --- presença: heartbeat do cliente logado (marca online + sala atual) ---
  if (path === '/api/presence/ping' && req.method === 'POST') {
    const u = await authedUser(req, res);
    if (!u) return;
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
    const rawRoom = (body as { room?: unknown }).room;
    const room = typeof rawRoom === 'string' && /^[A-Za-z0-9]{4,12}$/.test(rawRoom) ? rawRoom.toUpperCase() : null;
    presence.touch(u.id, room);
    sendJson(res, 200, { online: presence.count() });
    return;
  }

  // --- amigos: lista (aceitos + pendentes) com presença online ---
  if (path === '/api/friends' && req.method === 'GET') {
    const u = await authedUser(req, res);
    if (!u) return;
    sendJson(res, 200, await listFriends(u.id));
    return;
  }

  // --- amigos: enviar pedido por username ---
  if (path === '/api/friends/request' && req.method === 'POST') {
    const u = await authedUser(req, res);
    if (!u) return;
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Corpo inválido.' });
      return;
    }
    const username = typeof (body as { username?: unknown }).username === 'string' ? (body as { username: string }).username : '';
    if (!username.trim()) {
      sendJson(res, 400, { error: 'Informe um nome de usuário.' });
      return;
    }
    const result = await sendFriendRequest(u.id, username);
    if (!result.ok) {
      sendJson(res, result.httpStatus, { error: result.error });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- amigos: aceitar / remover (recusar/cancelar) por userId ---
  if ((path === '/api/friends/accept' || path === '/api/friends/remove') && req.method === 'POST') {
    const u = await authedUser(req, res);
    if (!u) return;
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Corpo inválido.' });
      return;
    }
    const otherId = typeof (body as { userId?: unknown }).userId === 'string' ? (body as { userId: string }).userId : '';
    if (!otherId) {
      sendJson(res, 400, { error: 'Usuário inválido.' });
      return;
    }
    const result =
      path === '/api/friends/accept'
        ? await acceptFriendRequest(u.id, otherId)
        : await removeFriend(u.id, otherId);
    if (!result.ok) {
      sendJson(res, result.httpStatus, { error: result.error });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- moderação: denunciar um jogador (por username) ---
  if (path === '/api/reports' && req.method === 'POST') {
    const u = await authedUser(req, res);
    if (!u) return;
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Corpo inválido.' });
      return;
    }
    const b = body as { username?: unknown; code?: unknown; reason?: unknown };
    const username = typeof b.username === 'string' ? b.username : '';
    if (!username.trim()) {
      sendJson(res, 400, { error: 'Informe um jogador.' });
      return;
    }
    const result = await reportUser(
      u.id,
      username,
      typeof b.code === 'string' ? b.code.toUpperCase() : null,
      typeof b.reason === 'string' ? b.reason : null,
    );
    if (!result.ok) {
      sendJson(res, result.httpStatus, { error: result.error });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- amigos: bloquear (por username) / desbloquear (por userId) ---
  if ((path === '/api/friends/block' || path === '/api/friends/unblock') && req.method === 'POST') {
    const u = await authedUser(req, res);
    if (!u) return;
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Corpo inválido.' });
      return;
    }
    const b = body as { username?: unknown; userId?: unknown };
    const result =
      path === '/api/friends/block'
        ? await blockUser(u.id, typeof b.username === 'string' ? b.username : '')
        : await unblockUser(u.id, typeof b.userId === 'string' ? b.userId : '');
    if (!result.ok) {
      sendJson(res, result.httpStatus, { error: result.error });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- notificações: pedidos de amizade + convites de sala + amigos online ---
  if (path === '/api/notifications' && req.method === 'GET') {
    const u = await authedUser(req, res);
    if (!u) return;
    const f = await listFriends(u.id);
    const inv = invites.listFor(u.id);
    const onlineFriends = f.friends.filter((x) => x.online);
    // Reconexão: partidas em andamento das quais sou membro, MENOS a que estou
    // jogando agora (presença) — é para voltar a uma sala da qual caí/saí.
    const rejoinAll = await listRejoinableRooms(u.id);
    const rejoin = rejoinAll.filter((r) => presence.roomOf(u.id) !== r.code);
    sendJson(res, 200, {
      friendRequests: f.incoming,
      invites: inv,
      onlineFriends,
      rejoin,
      count: f.incoming.length + inv.length + rejoin.length,
    });
    return;
  }

  // --- convidar um amigo para a minha sala ---
  if (path === '/api/invites' && req.method === 'POST') {
    const u = await authedUser(req, res);
    if (!u) return;
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Corpo inválido.' });
      return;
    }
    const b = body as { toUserId?: unknown; code?: unknown };
    const toUserId = typeof b.toUserId === 'string' ? b.toUserId : '';
    const code = typeof b.code === 'string' ? b.code.toUpperCase() : '';
    if (!toUserId || !code) {
      sendJson(res, 400, { error: 'Convite inválido.' });
      return;
    }
    const room = await getRoom(code);
    if (!room || room.status !== 'waiting') {
      sendJson(res, 409, { error: 'A sala não está mais aberta.' });
      return;
    }
    const [me] = await getDb()
      .select({ username: sql<string>`coalesce(${userTable.username}, ${userTable.name})` })
      .from(userTable)
      .where(eq(userTable.id, u.id))
      .limit(1);
    invites.add(toUserId, { userId: u.id, username: me?.username ?? 'alguém' }, code);
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- dispensar um convite recebido ---
  if (path === '/api/invites/dismiss' && req.method === 'POST') {
    const u = await authedUser(req, res);
    if (!u) return;
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
    const code = typeof (body as { code?: unknown }).code === 'string' ? (body as { code: string }).code.toUpperCase() : '';
    if (code) invites.remove(u.id, code);
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- matchmaking "Jogo rápido": entrar na fila / status / sair ---
  if (path === '/api/matchmaking/join' && req.method === 'POST') {
    const u = await authedUser(req, res);
    if (!u) return;
    sendJson(res, 200, await joinQuickMatch(u.id));
    return;
  }
  if (path === '/api/matchmaking/status' && req.method === 'GET') {
    const u = await authedUser(req, res);
    if (!u) return;
    sendJson(res, 200, await matchmakingStatus(u.id));
    return;
  }
  if (path === '/api/matchmaking/leave' && req.method === 'POST') {
    const u = await authedUser(req, res);
    if (!u) return;
    await leaveQuickMatch(u.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- salas: listagem do lobby (exige login — só a Home é pública) ---
  // Devolve as salas públicas + as salas de AMIGOS (incluindo privadas), sem duplicar.
  if (path === '/api/rooms' && req.method === 'GET') {
    const u = await authedUser(req, res);
    if (!u) return;
    const [publicRooms, friendRooms] = await Promise.all([listOpenRooms(), listFriendRooms(u.id)]);
    const friendCodes = new Set(friendRooms.map((r) => r.code));
    sendJson(res, 200, { rooms: publicRooms.filter((r) => !friendCodes.has(r.code)), friendRooms });
    return;
  }

  // --- salas: criação (exige login) ---
  if (path === '/api/rooms' && req.method === 'POST') {
    const u = await authedUser(req, res);
    if (!u) return;
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Corpo inválido.' });
      return;
    }
    const b = body as {
      name?: unknown;
      isPrivate?: unknown;
      maxPlayers?: unknown;
      boardLayout?: unknown;
      config?: unknown;
    };
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 40) : 'Sala sem nome';
    const room = await createRoom({
      hostUserId: u.id,
      name,
      isPrivate: b.isPrivate === true,
      maxPlayers: typeof b.maxPlayers === 'number' ? b.maxPlayers : 4,
      boardLayout: typeof b.boardLayout === 'string' ? b.boardLayout : 'standard',
      config: b.config && typeof b.config === 'object' ? (b.config as Record<string, unknown>) : undefined,
    });
    sendJson(res, 201, { room });
    return;
  }

  // --- salas: detalhe / editar / entrar / sair / bots / iniciar (por código) ---
  const roomMatch = /^\/api\/rooms\/([A-Za-z0-9]{4,12})(\/join|\/leave|\/start|\/bots)?$/.exec(path);
  if (roomMatch) {
    const code = roomMatch[1]!.toUpperCase();
    const sub = roomMatch[2];

    if (!sub && req.method === 'GET') {
      if (!getAuth()) {
        sendJson(res, 503, { error: 'Salas indisponiveis (sem banco configurado).' });
        return;
      }
      // viewer opcional: só para marcar isHost (não bloqueia ver o detalhe).
      const auth = getAuth()!;
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      const room = await getRoom(code, session?.user.id);
      if (!room) {
        sendJson(res, 404, { error: 'Sala não encontrada.' });
        return;
      }
      // Heartbeat: a tela de espera consulta esta rota em ciclo; enquanto um
      // membro a mantém aberta, adia a expiração da sala (item 6).
      if (session?.user.id) await touchRoomActivity(code, session.user.id);
      sendJson(res, 200, { room });
      return;
    }

    // Anfitrião ajusta as regras/mapa/nome/privacidade ao vivo.
    if (!sub && req.method === 'PATCH') {
      const u = await authedUser(req, res);
      if (!u) return;
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'Corpo inválido.' });
        return;
      }
      const result = await updateRoomSettings(code, u.id, body ?? {});
      if (!result.ok) {
        sendJson(res, result.httpStatus, { error: result.error });
        return;
      }
      sendJson(res, 200, { room: result.room });
      return;
    }

    if (sub === '/join' && req.method === 'POST') {
      const u = await authedUser(req, res);
      if (!u) return;
      const result = await joinRoom(code, u.id);
      if (!result.ok) {
        sendJson(res, result.httpStatus, { error: result.error });
        return;
      }
      sendJson(res, 200, { room: result.room });
      return;
    }

    // Sair da sala de espera (convidado libera a vaga; host encerra a sala).
    if (sub === '/leave' && req.method === 'POST') {
      const u = await authedUser(req, res);
      if (!u) return;
      const result = await leaveRoom(code, u.id);
      if (!result.ok) {
        sendJson(res, result.httpStatus, { error: result.error });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // Bots da sala (host): add / remove / difficulty — ação no corpo.
    if (sub === '/bots' && req.method === 'POST') {
      const u = await authedUser(req, res);
      if (!u) return;
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'Corpo inválido.' });
        return;
      }
      const b = body as { action?: unknown; color?: unknown; name?: unknown; difficulty?: unknown };
      const color = typeof b.color === 'string' ? b.color : '';
      const difficulty = typeof b.difficulty === 'string' ? b.difficulty : undefined;
      let result;
      if (b.action === 'remove') result = await removeBot(code, u.id, color);
      else if (b.action === 'difficulty') result = await updateBot(code, u.id, color, difficulty ?? 'medium');
      else result = await addBot(code, u.id, { name: typeof b.name === 'string' ? b.name : undefined, difficulty });
      if (!result.ok) {
        sendJson(res, result.httpStatus, { error: result.error });
        return;
      }
      sendJson(res, 200, { room: result.room });
      return;
    }

    if (sub === '/start' && req.method === 'POST') {
      const u = await authedUser(req, res);
      if (!u) return;
      const result = await startRoom(code, u.id);
      if (!result.ok) {
        sendJson(res, result.httpStatus, { error: result.error });
        return;
      }
      // Monta o RoomConfig final (host + bots + humanos ja sentados) e liga o
      // motor autoritativo (GameRoom) na sala viva compartilhada com o WS.
      const gameConfig = await buildRoomConfig(code);
      if (gameConfig) manager.startGame(code, gameConfig);
      sendJson(res, 200, { room: result.room });
      return;
    }
  }

  // qualquer outra rota /api/* desconhecida = 404 JSON (nao cai no SPA)
  if (path.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Rota nao encontrada.' });
    return;
  }

  // --- arquivos estaticos da SPA ---
  // Normaliza e impede path traversal para fora de WEB_DIST.
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const target = join(WEB_DIST, rel);
  if (target.startsWith(WEB_DIST)) {
    if (path !== '/' && (await serveFile(res, target))) return;
    // Fallback de SPA: entrega index.html para rotas do cliente (history API).
    if (await serveFile(res, join(WEB_DIST, 'index.html'))) return;
  }

  // Sem build da SPA disponivel (ex.: dev sem `npm run build`).
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404 — recurso nao encontrado.');
}

/**
 * Cria o servidor HTTP (sem ainda escutar). O caller chama `.listen()`.
 * `manager` e o MESMO RoomManager anexado ao WebSocket (index.ts) — a rota
 * `/start` liga o motor autoritativo nele para quem entrar pelo WS ja encontrar
 * a partida rodando.
 */
export function createHttpServer(manager: RoomManager): Server {
  return createServer((req, res) => {
    handleRequest(req, res, manager).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[trevalis][http] erro nao tratado:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Erro interno do servidor.' });
      else res.end();
    });
  });
}
