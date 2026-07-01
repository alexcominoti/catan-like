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
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  getDb,
  room as roomTable,
  roomPlayer as roomPlayerTable,
  user as userTable,
  type Db,
} from '@trevalis/db';
import { PLAYER_COLORS, type PlayerColor } from '@trevalis/engine';
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

/** Uma sala aparece na listagem pública? (aguardando jogadores e não privada). */
export function isListable(r: { status: RoomStatus; isPrivate: boolean }): boolean {
  return r.status === 'waiting' && !r.isPrivate;
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

export interface RoomView {
  code: string;
  name: string;
  status: RoomStatus;
  isPrivate: boolean;
  maxPlayers: number;
  boardLayout: string;
  hostUserId: string;
  isHost: boolean;
  players: RoomPlayerView[];
}

export interface RoomListItem {
  code: string;
  name: string;
  host: string;
  boardLayout: string;
  cur: number;
  max: number;
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

/** Cria uma sala 'waiting', já sentando o anfitrião no assento 0. */
export async function createRoom(input: CreateRoomInput): Promise<RoomView> {
  const db = getDb();
  const max = Math.min(Math.max(input.maxPlayers || 4, 2), PLAYER_COLORS.length);

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
    config: input.config ?? null,
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

  return {
    code,
    name: input.name,
    status: 'waiting',
    isPrivate: input.isPrivate,
    maxPlayers: max,
    boardLayout: input.boardLayout,
    hostUserId: input.hostUserId,
    isHost: true,
    players: await playersOf(db, id),
  };
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
      cur: sql<number>`(select count(*)::int from ${roomPlayerTable} where ${roomPlayerTable.roomId} = ${roomTable.id})`,
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
  }));
}

/** Cores ja reservadas para bots na config congelada na criacao (nao entram em room_player). */
function botColorsOf(config: unknown): PlayerColor[] {
  const bots = (config as { bots?: unknown } | null)?.bots;
  return Array.isArray(bots) ? (bots as PlayerColor[]) : [];
}

/** Detalhes de uma sala pelo código (ou null — inclui salas 'abandoned': o link fica invalidado). */
export async function getRoom(code: string, viewerId?: string): Promise<RoomView | null> {
  const db = getDb();
  const [r] = await db.select().from(roomTable).where(eq(roomTable.code, code)).limit(1);
  if (!r || r.status === 'abandoned') return null;
  return {
    code: r.code,
    name: r.name,
    status: r.status as RoomStatus,
    isPrivate: r.isPrivate,
    maxPlayers: r.maxPlayers,
    boardLayout: r.boardLayout,
    hostUserId: r.hostUserId,
    isHost: viewerId === r.hostUserId,
    players: await playersOf(db, r.id),
  };
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

  const room = await getRoom(code, userId);
  return { ok: true, room: room! };
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

  const botColors = botColorsOf(raw);
  const rawPlayers = Array.isArray(raw.players)
    ? (raw.players as { color: PlayerColor; name: string }[])
    : [];
  const seated = await getSeatedPlayers(code);

  const humanEntries = seated.map((s) => ({ color: s.color, name: s.username, userId: s.userId }));
  const botEntries = rawPlayers
    .filter((p) => botColors.includes(p.color))
    .map((p) => ({ color: p.color, name: p.name }));

  const seed = typeof raw.seed === 'number' ? raw.seed : Math.floor(Math.random() * 2 ** 31);
  const botDifficulty = (raw.botDifficulty ?? {}) as RoomConfig['botDifficulty'];

  return {
    seed,
    boardLayout: (raw.boardLayout as RoomConfig['boardLayout']) ?? 'standard',
    pace: (raw.pace as Pace) ?? 'normal',
    players: [...humanEntries, ...botEntries],
    bots: botColors,
    botDifficulty,
    numberLayout: (raw.numberLayout as RoomConfig['numberLayout']) ?? 'balanced',
    desert: (raw.desert as RoomConfig['desert']) ?? 'random',
    pointsToWin: typeof raw.pointsToWin === 'number' ? raw.pointsToWin : 10,
    discardLimit: typeof raw.discardLimit === 'number' ? raw.discardLimit : 7,
    friendlyRobber: raw.friendlyRobber === true,
  };
}
