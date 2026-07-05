/**
 * Salas online — camada de METADADOS duráveis (item 2 do backlog de produto).
 *
 * O `GameState` vivo continua só na memória do servidor (GameRoom/WS). Aqui só
 * gravamos os metadados que precisam sobreviver entre requisições HTTP: listagem
 * pública do lobby e o ciclo do link único `/room/<code>`.
 *
 * O arquivo é dividido em:
 *  1. NÚCLEO PURO (sem I/O) — regras testáveis: geração de código, escolha de
 *     assento/cor, decisão de entrada (sala cheia / em andamento) e o filtro de
 *     listabilidade. Coberto por test/rooms.test.ts.
 *  2. I/O no banco (Drizzle) — usa o núcleo puro.
 */
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import {
  getDb,
  friendship as friendshipTable,
  room as roomTable,
  roomPlayer as roomPlayerTable,
  user as userTable,
  type Db,
} from '@trevalis/db';
import { PLAYER_COLORS, type PlayerColor } from '@trevalis/engine';
import type { Difficulty } from '@trevalis/bot';
import type { Pace, RoomConfig } from './protocol.js';

/* ------------------------------------------------------------------ */
/* 1. Núcleo puro (testável, sem banco)                                */
/* ------------------------------------------------------------------ */

/** Status possíveis de uma sala (espelha schema.room.status). */
export type RoomStatus = 'waiting' | 'in_progress' | 'finished' | 'abandoned';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I/O/0/1 (ambíguos)
const CODE_LEN = 6;

/** Gera um código curto p/ o link (`/room/<code>`). `rand` injetável p/ testes. */
export function makeRoomCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Próximo assento livre (cor + índice) dadas as cores já ocupadas. */
export function nextSeat(usedColors: readonly PlayerColor[]): { color: PlayerColor; seatIndex: number } | null {
  const color = PLAYER_COLORS.find((c) => !usedColors.includes(c));
  if (!color) return null;
  return { color, seatIndex: usedColors.length };
}

/** Cada mapa define o LIMITE de jogadores (espelha os MAPS da UI). */
export const MAP_LIMIT: Record<string, number> = { standard: 4, large: 6, huge: 8 };
export function mapLimit(boardLayout: string): number {
  return MAP_LIMIT[boardLayout] ?? 4;
}

/** Um bot sentado numa sala (mora na config da sala; muda ao vivo até a partida começar). */
export interface BotSeat {
  color: PlayerColor;
  name: string;
  difficulty: Difficulty;
}

/** Uma sala aparece na listagem pública? (aguardando jogadores e não privada). */
export function isListable(r: { status: RoomStatus; isPrivate: boolean }): boolean {
  return r.status === 'waiting' && !r.isPrivate;
}

/** Tempo (ms) sem NENHUM membro com a aba aberta até uma sala 'waiting' expirar. */
export const STALE_WAITING_ROOM_TTL_MS = 15 * 60 * 1000;

/**
 * Uma sala 'waiting' está inativa (elegível para limpeza automática)? É o caso
 * quando nenhum membro toca a sala (a tela de espera faz um heartbeat enquanto
 * aberta) há mais que `ttlMs`. Só salas 'waiting' expiram assim; 'in_progress'
 * é cuidada pela presença ao vivo (LiveRoom) e 'finished' é preservada.
 * Função pura (ms) para ser testável sem banco.
 */
export function isStaleWaitingRoom(
  r: { status: RoomStatus; lastActivityAt: number },
  ttlMs: number,
  now: number,
): boolean {
  return r.status === 'waiting' && now - r.lastActivityAt >= ttlMs;
}

export interface JoinDecision {
  ok: boolean;
  error?: string;
  httpStatus?: number;
}

/**
 * Pode entrar nesta sala? Regras (item 2): autenticação é checada na camada HTTP.
 *  - Já é membro → ok (idempotente: reabrir o link não duplica o assento).
 *  - Não está "waiting" (em andamento/encerrada) → bloqueia.
 *  - Cheia (current >= max) → "Sala cheia".
 */
export function decideJoin(
  r: { status: RoomStatus; current: number; max: number },
  alreadyMember: boolean,
): JoinDecision {
  if (alreadyMember) return { ok: true };
  if (r.status !== 'waiting') return { ok: false, error: 'A partida já começou.', httpStatus: 409 };
  if (r.current >= r.max) return { ok: false, error: 'Sala cheia.', httpStatus: 409 };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 2. I/O no banco                                                     */
/* ------------------------------------------------------------------ */

export interface RoomPlayerView {
  username: string;
  color: PlayerColor;
  isHost: boolean;
}

/** Um assento ocupado na sala de espera: humano (host/convidado) OU bot. */
export interface RoomSeatView {
  name: string;
  color: PlayerColor;
  isHost: boolean;
  isBot: boolean;
  difficulty?: Difficulty;
}

/** Regras da partida que o anfitrião ajusta ao vivo na sala (persistem na config). */
export interface RoomSettings {
  seed: number | null;
  pace: Pace;
  numberLayout: string;
  desert: string;
  pointsToWin: number;
  discardLimit: number;
  friendlyRobber: boolean;
  balancedDice: boolean;
}

export interface RoomView {
  code: string;
  name: string;
  status: RoomStatus;
  isPrivate: boolean;
  maxPlayers: number;
  boardLayout: string;
  hostUserId: string;
  isHost: boolean;
  /** Assentos ocupados (humanos + bots), em ordem de cor. */
  players: RoomSeatView[];
  settings: RoomSettings;
}

export interface RoomListItem {
  code: string;
  name: string;
  host: string;
  boardLayout: string;
  cur: number;
  max: number;
  isPrivate: boolean;
}

function genId(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
  );
}

/** Lê os assentos de uma sala (com username do jogador), em ordem de assento. */
async function playersOf(db: Db, roomId: string): Promise<RoomPlayerView[]> {
  const rows = await db
    .select({
      username: sql<string>`coalesce(${userTable.username}, ${userTable.name})`,
      color: roomPlayerTable.color,
      isHost: roomPlayerTable.isHost,
      seatIndex: roomPlayerTable.seatIndex,
    })
    .from(roomPlayerTable)
    .innerJoin(userTable, eq(userTable.id, roomPlayerTable.userId))
    .where(eq(roomPlayerTable.roomId, roomId))
    .orderBy(asc(roomPlayerTable.seatIndex));
  return rows.map((r) => ({ username: r.username, color: r.color as PlayerColor, isHost: r.isHost }));
}

export interface CreateRoomInput {
  hostUserId: string;
  name: string;
  isPrivate: boolean;
  maxPlayers: number;
  boardLayout: string;
  config?: Record<string, unknown>;
}

/** Cria uma sala 'waiting' já com o anfitrião sentado; bots começam vazios (o host adiciona ao vivo). */
export async function createRoom(input: CreateRoomInput): Promise<RoomView> {
  const db = getDb();
  // O mapa define o limite; a config guarda bots (começa vazia) e as regras.
  const max = mapLimit(input.boardLayout);
  const config = { ...(input.config ?? {}), bots: botsOf(input.config) };

  // Código único (tenta de novo no caso raríssimo de colisão).
  let code = makeRoomCode();
  for (let i = 0; i < 5; i++) {
    const existing = await db
      .select({ id: roomTable.id })
      .from(roomTable)
      .where(eq(roomTable.code, code))
      .limit(1);
    if (existing.length === 0) break;
    code = makeRoomCode();
  }

  const id = genId();
  await db.insert(roomTable).values({
    id,
    code,
    name: input.name,
    hostUserId: input.hostUserId,
    config,
    status: 'waiting',
    isPrivate: input.isPrivate,
    maxPlayers: max,
    boardLayout: input.boardLayout,
  });
  const seat = nextSeat([])!;
  await db.insert(roomPlayerTable).values({
    roomId: id,
    userId: input.hostUserId,
    color: seat.color,
    seatIndex: seat.seatIndex,
    isHost: true,
  });

  const [r] = await db.select().from(roomTable).where(eq(roomTable.id, id)).limit(1);
  return buildRoomView(db, r!, input.hostUserId);
}

/** Salas abertas para o lobby: 'waiting' e não privadas, com contagem de jogadores. */
export async function listOpenRooms(): Promise<RoomListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      code: roomTable.code,
      name: roomTable.name,
      host: sql<string>`coalesce(${userTable.username}, ${userTable.name})`,
      boardLayout: roomTable.boardLayout,
      max: roomTable.maxPlayers,
      cur: sql<number>`((select count(*)::int from ${roomPlayerTable} where ${roomPlayerTable.roomId} = ${roomTable.id}) + coalesce(jsonb_array_length(${roomTable.config} -> 'bots'), 0))`,
    })
    .from(roomTable)
    .innerJoin(userTable, eq(userTable.id, roomTable.hostUserId))
    .where(and(eq(roomTable.status, 'waiting'), eq(roomTable.isPrivate, false)))
    .orderBy(asc(roomTable.createdAt));
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    host: r.host,
    boardLayout: r.boardLayout,
    cur: Number(r.cur),
    max: r.max,
    isPrivate: false, // esta listagem só traz salas públicas
  }));
}

/**
 * Salas de AMIGOS visíveis no lobby (Tier social): mesas 'waiting' cujo anfitrião
 * é um amigo aceito meu — INCLUINDO as privadas (o amigo não precisa de link).
 * Exclui mesas de matchmaking e a minha própria. Uma sala pública de amigo também
 * aparece aqui (o chamador tira a duplicata da lista pública).
 */
export async function listFriendRooms(userId: string): Promise<RoomListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      code: roomTable.code,
      name: roomTable.name,
      host: sql<string>`coalesce(${userTable.username}, ${userTable.name})`,
      boardLayout: roomTable.boardLayout,
      max: roomTable.maxPlayers,
      isPrivate: roomTable.isPrivate,
      cur: sql<number>`((select count(*)::int from ${roomPlayerTable} where ${roomPlayerTable.roomId} = ${roomTable.id}) + coalesce(jsonb_array_length(${roomTable.config} -> 'bots'), 0))`,
    })
    .from(roomTable)
    .innerJoin(userTable, eq(userTable.id, roomTable.hostUserId))
    .innerJoin(
      friendshipTable,
      and(
        eq(friendshipTable.status, 'accepted'),
        or(
          and(eq(friendshipTable.requesterId, userId), eq(friendshipTable.addresseeId, roomTable.hostUserId)),
          and(eq(friendshipTable.addresseeId, userId), eq(friendshipTable.requesterId, roomTable.hostUserId)),
        ),
      ),
    )
    .where(
      and(
        eq(roomTable.status, 'waiting'),
        sql`${roomTable.hostUserId} <> ${userId}`,
        sql`not (${roomTable.config} @> '{"matchmade":true}'::jsonb)`,
      ),
    )
    .orderBy(asc(roomTable.createdAt));
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    host: r.host,
    boardLayout: r.boardLayout,
    cur: Number(r.cur),
    max: r.max,
    isPrivate: r.isPrivate,
  }));
}

/** Bots sentados na sala (moram na config; mudam ao vivo). Tolera formato antigo (só cores). */
export function botsOf(config: unknown): BotSeat[] {
  const bots = (config as { bots?: unknown } | null)?.bots;
  if (!Array.isArray(bots)) return [];
  return bots
    .map((b): BotSeat => {
      if (typeof b === 'string') return { color: b as PlayerColor, name: 'Bot', difficulty: 'medium' };
      const o = b as Partial<BotSeat>;
      return { color: o.color as PlayerColor, name: o.name ?? 'Bot', difficulty: o.difficulty ?? 'medium' };
    })
    .filter((b) => PLAYER_COLORS.includes(b.color));
}

/** Cores ocupadas por bots (contam como assento cheio no join). */
function botColorsOf(config: unknown): PlayerColor[] {
  return botsOf(config).map((b) => b.color);
}

/** Regras da partida guardadas na config (com defaults). */
function settingsOf(config: unknown): RoomSettings {
  const c = (config ?? {}) as Record<string, unknown>;
  return {
    seed: typeof c.seed === 'number' ? c.seed : null,
    pace: (c.pace as Pace) === 'fast' ? 'fast' : 'normal',
    numberLayout: typeof c.numberLayout === 'string' ? c.numberLayout : 'balanced',
    desert: typeof c.desert === 'string' ? c.desert : 'random',
    pointsToWin: typeof c.pointsToWin === 'number' ? c.pointsToWin : 10,
    discardLimit: typeof c.discardLimit === 'number' ? c.discardLimit : 7,
    friendlyRobber: c.friendlyRobber === true,
    balancedDice: c.balancedDice === true,
  };
}

/** Monta a visão da sala (humanos + bots no roster, regras) a partir da linha do banco. */
async function buildRoomView(
  db: Db,
  r: typeof roomTable.$inferSelect,
  viewerId?: string,
): Promise<RoomView> {
  const humans = await playersOf(db, r.id);
  const bots = botsOf(r.config);
  const players: RoomSeatView[] = [
    ...humans.map((h) => ({ name: h.username, color: h.color, isHost: h.isHost, isBot: false })),
    ...bots.map((b) => ({ name: b.name, color: b.color, isHost: false, isBot: true, difficulty: b.difficulty })),
  ];
  players.sort((a, b) => PLAYER_COLORS.indexOf(a.color) - PLAYER_COLORS.indexOf(b.color));
  return {
    code: r.code,
    name: r.name,
    status: r.status as RoomStatus,
    isPrivate: r.isPrivate,
    maxPlayers: r.maxPlayers,
    boardLayout: r.boardLayout,
    hostUserId: r.hostUserId,
    isHost: viewerId === r.hostUserId,
    players,
    settings: settingsOf(r.config),
  };
}

/** Detalhes de uma sala pelo código (ou null — inclui salas 'abandoned': o link fica invalidado). */
export async function getRoom(code: string, viewerId?: string): Promise<RoomView | null> {
  const db = getDb();
  const [r] = await db.select().from(roomTable).where(eq(roomTable.code, code)).limit(1);
  if (!r || r.status === 'abandoned') return null;
  return buildRoomView(db, r, viewerId);
}

export type JoinResult =
  | { ok: true; room: RoomView }
  | { ok: false; error: string; httpStatus: number };

/**
 * Entra (ou reentra) numa sala pelo código. Autenticação já foi verificada na
 * camada HTTP. Idempotente para quem já é membro (reabrir o link não duplica).
 */
export async function joinRoom(code: string, userId: string): Promise<JoinResult> {
  const db = getDb();
  const [r] = await db.select().from(roomTable).where(eq(roomTable.code, code)).limit(1);
  if (!r || r.status === 'abandoned') return { ok: false, error: 'Sala não encontrada.', httpStatus: 404 };

  const seats = await db
    .select({ userId: roomPlayerTable.userId, color: roomPlayerTable.color })
    .from(roomPlayerTable)
    .where(eq(roomPlayerTable.roomId, r.id));
  const alreadyMember = seats.some((s) => s.userId === userId);
  // Cores ja reservadas para bots (config congelada na criacao) contam como assento ocupado.
  const botColors = botColorsOf(r.config);

  const decision = decideJoin(
    { status: r.status as RoomStatus, current: seats.length + botColors.length, max: r.maxPlayers },
    alreadyMember,
  );
  if (!decision.ok) {
    return { ok: false, error: decision.error!, httpStatus: decision.httpStatus ?? 409 };
  }

  if (!alreadyMember) {
    const usedColors = [...seats.map((s) => s.color as PlayerColor), ...botColors];
    const seat = nextSeat(usedColors);
    if (!seat) return { ok: false, error: 'Sala cheia.', httpStatus: 409 };
    await db.insert(roomPlayerTable).values({
      roomId: r.id,
      userId,
      color: seat.color,
      seatIndex: seat.seatIndex,
      isHost: false,
    });
  }

  // Entrar (ou reabrir o link) é atividade: adia a expiração da sala de espera.
  await db.update(roomTable).set({ lastActivityAt: new Date() }).where(eq(roomTable.id, r.id));

  const room = await getRoom(code, userId);
  return { ok: true, room: room! };
}

/**
 * Heartbeat da sala de espera: enquanto um MEMBRO (host ou sentado) tem a tela
 * aberta, ela toca a sala periodicamente para adiar a expiração. Sem membro com
 * a aba aberta, `lastActivityAt` para de avançar e a sala 'waiting' expira após
 * `STALE_WAITING_ROOM_TTL_MS`. Ignora salas que já saíram de 'waiting'.
 */
export async function touchRoomActivity(code: string, userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(roomTable)
    .set({ lastActivityAt: new Date() })
    .where(
      and(
        eq(roomTable.code, code),
        eq(roomTable.status, 'waiting'),
        sql`(${roomTable.hostUserId} = ${userId} or exists (select 1 from ${roomPlayerTable} where ${roomPlayerTable.roomId} = ${roomTable.id} and ${roomPlayerTable.userId} = ${userId}))`,
      ),
    );
}

/**
 * Limpeza automática (item 6): apaga do banco as salas 'waiting' inativas há mais
 * de `ttlMs` (nenhum membro com a aba aberta). Some do lobby (a listagem só mostra
 * 'waiting') e do banco (o `room_player` cai por cascade). Devolve os códigos
 * removidos. Não toca 'in_progress' (presença ao vivo) nem 'finished' (histórico).
 */
export async function sweepStaleWaitingRooms(
  ttlMs = STALE_WAITING_ROOM_TTL_MS,
  now = Date.now(),
): Promise<string[]> {
  const db = getDb();
  const cutoff = new Date(now - ttlMs);
  const deleted = await db
    .delete(roomTable)
    .where(and(eq(roomTable.status, 'waiting'), lt(roomTable.lastActivityAt, cutoff)))
    .returning({ code: roomTable.code });
  return deleted.map((r) => r.code);
}

/** Marca a sala como 'in_progress' (host inicia a partida) — sai da listagem. */
export async function startRoom(code: string, hostUserId: string): Promise<JoinResult> {
  const db = getDb();
  const [r] = await db.select().from(roomTable).where(eq(roomTable.code, code)).limit(1);
  if (!r || r.status === 'abandoned') return { ok: false, error: 'Sala não encontrada.', httpStatus: 404 };
  if (r.hostUserId !== hostUserId) {
    return { ok: false, error: 'Apenas o anfitrião pode iniciar.', httpStatus: 403 };
  }
  if (r.status !== 'waiting') {
    return { ok: false, error: 'A partida já começou.', httpStatus: 409 };
  }
  await db
    .update(roomTable)
    .set({ status: 'in_progress', startedAt: new Date() })
    .where(eq(roomTable.id, r.id));
  const room = await getRoom(code, hostUserId);
  return { ok: true, room: room! };
}

/**
 * Inicia uma sala pelo SISTEMA (sem checagem de anfitrião) — usado pelo
 * matchmaking, que enche a mesa de bots e começa a partida automaticamente.
 * Só age em salas ainda 'waiting'.
 */
export async function forceStartRoom(code: string): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(roomTable)
    .set({ status: 'in_progress', startedAt: new Date() })
    .where(and(eq(roomTable.code, code), eq(roomTable.status, 'waiting')))
    .returning({ id: roomTable.id });
  return updated.length > 0;
}

/* ------------------------------------------------------------------ */
/* Edição AO VIVO da sala de espera (host muda regras/bots; convidados entram/saem)  */
/* ------------------------------------------------------------------ */

/** Carrega uma sala editável pelo host (existe, é dele e ainda está 'waiting'). */
async function loadEditableRoom(
  db: Db,
  code: string,
  hostUserId: string,
): Promise<
  | { ok: true; row: typeof roomTable.$inferSelect }
  | { ok: false; error: string; httpStatus: number }
> {
  const [r] = await db.select().from(roomTable).where(eq(roomTable.code, code)).limit(1);
  if (!r || r.status === 'abandoned') return { ok: false, error: 'Sala não encontrada.', httpStatus: 404 };
  if (r.hostUserId !== hostUserId) return { ok: false, error: 'Apenas o anfitrião pode alterar a sala.', httpStatus: 403 };
  if (r.status !== 'waiting') return { ok: false, error: 'A partida já começou.', httpStatus: 409 };
  return { ok: true, row: r };
}

/** Ocupação atual: cores humanas (room_player) + bots (config). */
async function occupancyOf(
  db: Db,
  roomId: string,
  config: unknown,
): Promise<{ humanColors: PlayerColor[]; bots: BotSeat[]; total: number }> {
  const seats = await db
    .select({ color: roomPlayerTable.color })
    .from(roomPlayerTable)
    .where(eq(roomPlayerTable.roomId, roomId));
  const humanColors = seats.map((s) => s.color as PlayerColor);
  const bots = botsOf(config);
  return { humanColors, bots, total: humanColors.length + bots.length };
}

async function reloadView(db: Db, id: string, viewerId: string): Promise<RoomView> {
  const [r] = await db.select().from(roomTable).where(eq(roomTable.id, id)).limit(1);
  return buildRoomView(db, r!, viewerId);
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** Ajusta regras/mapa/nome/privacidade da sala (host, só enquanto 'waiting'). Sanitiza a entrada. */
export async function updateRoomSettings(code: string, hostUserId: string, patch: unknown): Promise<JoinResult> {
  const db = getDb();
  const loaded = await loadEditableRoom(db, code, hostUserId);
  if (!loaded.ok) return loaded;
  const r = loaded.row;

  const p = (patch ?? {}) as Record<string, unknown>;
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(p, k);
  const cur = settingsOf(r.config);

  const nextLayout = typeof p.boardLayout === 'string' && MAP_LIMIT[p.boardLayout] ? p.boardLayout : r.boardLayout;
  const nextMax = mapLimit(nextLayout);
  const { total } = await occupancyOf(db, r.id, r.config);
  if (total > nextMax) {
    return { ok: false, error: `Esse mapa comporta no máximo ${nextMax} jogadores.`, httpStatus: 409 };
  }

  const newConfig = {
    ...((r.config ?? {}) as Record<string, unknown>),
    boardLayout: nextLayout,
    seed: has('seed') ? (typeof p.seed === 'number' ? p.seed : null) : cur.seed,
    pace: p.pace === 'fast' ? 'fast' : p.pace === 'normal' ? 'normal' : cur.pace,
    numberLayout: p.numberLayout === 'random' || p.numberLayout === 'balanced' ? p.numberLayout : cur.numberLayout,
    // Deserto no centro só existe no mapa 3–4.
    desert: nextLayout !== 'standard' ? 'random' : p.desert === 'center' || p.desert === 'random' ? p.desert : cur.desert,
    pointsToWin: clampInt(typeof p.pointsToWin === 'number' ? p.pointsToWin : cur.pointsToWin, 3, 15),
    discardLimit: clampInt(typeof p.discardLimit === 'number' ? p.discardLimit : cur.discardLimit, 5, 15),
    friendlyRobber: has('friendlyRobber') ? p.friendlyRobber === true : cur.friendlyRobber,
    balancedDice: has('balancedDice') ? p.balancedDice === true : cur.balancedDice,
    bots: botsOf(r.config),
  };
  await db
    .update(roomTable)
    .set({
      name: typeof p.name === 'string' ? p.name.trim().slice(0, 40) || r.name : r.name,
      isPrivate: has('isPrivate') ? p.isPrivate === true : r.isPrivate,
      boardLayout: nextLayout,
      maxPlayers: nextMax,
      config: newConfig,
      lastActivityAt: new Date(),
    })
    .where(eq(roomTable.id, r.id));
  return { ok: true, room: await reloadView(db, r.id, hostUserId) };
}

/** Adiciona um bot (o servidor escolhe a próxima cor livre). Host, só 'waiting'. */
export async function addBot(code: string, hostUserId: string, opts: { name?: string; difficulty?: string }): Promise<JoinResult> {
  const db = getDb();
  const loaded = await loadEditableRoom(db, code, hostUserId);
  if (!loaded.ok) return loaded;
  const r = loaded.row;
  const { humanColors, bots, total } = await occupancyOf(db, r.id, r.config);
  if (total >= r.maxPlayers) return { ok: false, error: 'Sala cheia.', httpStatus: 409 };
  const seat = nextSeat([...humanColors, ...bots.map((b) => b.color)]);
  if (!seat) return { ok: false, error: 'Sala cheia.', httpStatus: 409 };
  const difficulty: Difficulty = opts.difficulty === 'easy' || opts.difficulty === 'hard' ? opts.difficulty : 'medium';
  const name = (opts.name?.trim() || `Bot ${seat.color}`).slice(0, 16);
  const newConfig = {
    ...((r.config ?? {}) as Record<string, unknown>),
    bots: [...bots, { color: seat.color, name, difficulty }],
  };
  await db.update(roomTable).set({ config: newConfig, lastActivityAt: new Date() }).where(eq(roomTable.id, r.id));
  return { ok: true, room: await reloadView(db, r.id, hostUserId) };
}

/** Remove um bot pela cor. Host, só 'waiting'. */
export async function removeBot(code: string, hostUserId: string, color: string): Promise<JoinResult> {
  const db = getDb();
  const loaded = await loadEditableRoom(db, code, hostUserId);
  if (!loaded.ok) return loaded;
  const r = loaded.row;
  const bots = botsOf(r.config).filter((b) => b.color !== color);
  const newConfig = { ...((r.config ?? {}) as Record<string, unknown>), bots };
  await db.update(roomTable).set({ config: newConfig, lastActivityAt: new Date() }).where(eq(roomTable.id, r.id));
  return { ok: true, room: await reloadView(db, r.id, hostUserId) };
}

/** Muda a dificuldade de um bot já sentado. Host, só 'waiting'. */
export async function updateBot(code: string, hostUserId: string, color: string, difficulty: string): Promise<JoinResult> {
  const db = getDb();
  const loaded = await loadEditableRoom(db, code, hostUserId);
  if (!loaded.ok) return loaded;
  const r = loaded.row;
  const diff: Difficulty = difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'medium';
  const bots = botsOf(r.config).map((b) => (b.color === color ? { ...b, difficulty: diff } : b));
  const newConfig = { ...((r.config ?? {}) as Record<string, unknown>), bots };
  await db.update(roomTable).set({ config: newConfig, lastActivityAt: new Date() }).where(eq(roomTable.id, r.id));
  return { ok: true, room: await reloadView(db, r.id, hostUserId) };
}

/** Sai da sala de espera: um convidado libera a vaga; o host encerra a sala inteira. */
export async function leaveRoom(code: string, userId: string): Promise<{ ok: true } | { ok: false; error: string; httpStatus: number }> {
  const db = getDb();
  const [r] = await db.select().from(roomTable).where(eq(roomTable.code, code)).limit(1);
  if (!r || r.status === 'abandoned') return { ok: true }; // já não existe: idempotente
  if (r.status !== 'waiting') return { ok: false, error: 'A partida já começou.', httpStatus: 409 };
  if (r.hostUserId === userId) {
    await db.delete(roomTable).where(eq(roomTable.id, r.id)); // host encerra: cascade remove os assentos
    return { ok: true };
  }
  await db.delete(roomPlayerTable).where(and(eq(roomPlayerTable.roomId, r.id), eq(roomPlayerTable.userId, userId)));
  await db.update(roomTable).set({ lastActivityAt: new Date() }).where(eq(roomTable.id, r.id));
  return { ok: true };
}

/** Assentos humanos de uma sala (userId + cor), em ordem de assento — usado ao montar o RoomConfig final. */
export async function getSeatedPlayers(
  code: string,
): Promise<{ userId: string; color: PlayerColor; username: string }[]> {
  const db = getDb();
  const [r] = await db.select().from(roomTable).where(eq(roomTable.code, code)).limit(1);
  if (!r) return [];
  const rows = await db
    .select({
      userId: roomPlayerTable.userId,
      color: roomPlayerTable.color,
      username: sql<string>`coalesce(${userTable.username}, ${userTable.name})`,
      seatIndex: roomPlayerTable.seatIndex,
    })
    .from(roomPlayerTable)
    .innerJoin(userTable, eq(userTable.id, roomPlayerTable.userId))
    .where(eq(roomPlayerTable.roomId, r.id))
    .orderBy(asc(roomPlayerTable.seatIndex));
  return rows.map((row) => ({ userId: row.userId, color: row.color as PlayerColor, username: row.username }));
}

/** Configuracao bruta (jsonb) gravada na criacao da sala — usada para montar o RoomConfig final ao iniciar. */
export async function getRoomConfig(code: string): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const [r] = await db.select({ config: roomTable.config }).from(roomTable).where(eq(roomTable.code, code)).limit(1);
  return (r?.config as Record<string, unknown> | undefined) ?? null;
}

/**
 * Marca a sala como encerrada (fim de partida real, nao abandono): status
 * 'finished' + `finishedAt`. A sala continua acessivel pelo link (revisao do
 * resultado) ate a limpeza de sala vazia remove-la da memoria (o registro no
 * banco permanece).
 */
export async function finishRoom(code: string): Promise<void> {
  const db = getDb();
  await db
    .update(roomTable)
    .set({ status: 'finished', finishedAt: new Date() })
    .where(and(eq(roomTable.code, code), eq(roomTable.status, 'in_progress')));
}

/**
 * Sala esvaziada por 5 min sem nenhum humano conectado (item 6): se ainda nao
 * tinha terminado, marca 'abandoned' (invalida o link). Uma sala ja 'finished'
 * NAO e regravada — o resultado continua acessivel via metadados no banco.
 */
export async function abandonIfNotFinished(code: string): Promise<void> {
  const db = getDb();
  await db
    .update(roomTable)
    .set({ status: 'abandoned' })
    .where(and(eq(roomTable.code, code), sql`${roomTable.status} in ('waiting', 'in_progress')`));
}

/**
 * Monta o `RoomConfig` FINAL (para o motor autoritativo) a partir da config
 * congelada na criacao + de quem realmente entrou pelo link ate agora: humanos
 * vem de `room_player` (userId + username atual); bots vem da config original
 * (cor + nome + dificuldade escolhidos pelo anfitriao). Vagas nunca ocupadas
 * simplesmente nao entram na partida (mesmo comportamento do modo local).
 * `null` se a sala nao existe ou nao tem config gravada.
 */
export async function buildRoomConfig(code: string): Promise<RoomConfig | null> {
  const raw = await getRoomConfig(code);
  if (!raw) return null;

  const bots = botsOf(raw); // {color, name, difficulty}[] — estado ao vivo no momento do start
  const seated = await getSeatedPlayers(code);

  const humanEntries = seated.map((s) => ({ color: s.color, name: s.username, userId: s.userId }));
  const botEntries = bots.map((b) => ({ color: b.color, name: b.name }));

  const seed = typeof raw.seed === 'number' ? raw.seed : Math.floor(Math.random() * 2 ** 31);
  const botDifficulty = Object.fromEntries(bots.map((b) => [b.color, b.difficulty])) as RoomConfig['botDifficulty'];

  return {
    seed,
    boardLayout: (raw.boardLayout as RoomConfig['boardLayout']) ?? 'standard',
    pace: (raw.pace as Pace) ?? 'normal',
    players: [...humanEntries, ...botEntries],
    bots: bots.map((b) => b.color),
    botDifficulty,
    numberLayout: (raw.numberLayout as RoomConfig['numberLayout']) ?? 'balanced',
    desert: (raw.desert as RoomConfig['desert']) ?? 'random',
    pointsToWin: typeof raw.pointsToWin === 'number' ? raw.pointsToWin : 10,
    discardLimit: typeof raw.discardLimit === 'number' ? raw.discardLimit : 7,
    friendlyRobber: raw.friendlyRobber === true,
    balancedDice: raw.balancedDice === true,
  };
}
