/**
 * Matchmaking "Jogo rápido" (Tier 2) — fila casual que entra direto numa mesa,
 * sem precisar de link. Reaproveita todo o ciclo de sala (createRoom/joinRoom/
 * forceStartRoom + o RoomManager autoritativo): uma sala "matchmade" nasce
 * privada, junta quem clicar em "Jogo rápido" e, quando enche (ou após uma
 * espera), completa com bots e começa sozinha (Colonist "Find Game", v119).
 *
 * NÚCLEO PURO (decisão de quando iniciar / quantos bots) + I/O (Drizzle) + um
 * tick periódico chamado pelo servidor.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, room as roomTable, roomPlayer as roomPlayerTable, type Db } from '@trevalis/db';
import type { PlayerColor } from '@trevalis/engine';
import { botsOf, buildRoomConfig, createRoom, forceStartRoom, joinRoom, leaveRoom, nextSeat } from './rooms.js';
import type { RoomManager } from './room.js';

/* ------------------------------------------------------------------ */
/* 1. Núcleo puro (testável)                                           */
/* ------------------------------------------------------------------ */

export interface MatchmakingTuning {
  /** Alvo de jogadores na mesa (humanos + bots que completam). */
  target: number;
  /** Mínimo de humanos para começar antes da espera acabar. */
  minHumans: number;
  /** Após tantos ms com >= minHumans, começa (completando com bots). */
  startDelayMs: number;
  /** Teto de espera: com >=1 humano, começa de qualquer jeito (só com bots). */
  maxWaitMs: number;
}

export const DEFAULT_TUNING: MatchmakingTuning = {
  target: 4,
  minHumans: 2,
  startDelayMs: 15_000,
  maxWaitMs: 45_000,
};

/** Uma sala matchmade deve começar agora? (função pura). */
export function shouldStartMatch(humans: number, waitedMs: number, t: MatchmakingTuning = DEFAULT_TUNING): boolean {
  if (humans >= t.target) return true; // mesa cheia de humanos
  if (humans >= t.minHumans && waitedMs >= t.startDelayMs) return true; // gente suficiente + espera
  if (humans >= 1 && waitedMs >= t.maxWaitMs) return true; // desistiu de esperar: completa com bots
  return false;
}

/** Quantos bots adicionar para atingir o alvo. */
export function botsToAdd(humans: number, existingBots: number, target = DEFAULT_TUNING.target): number {
  return Math.max(0, target - humans - existingBots);
}

/* ------------------------------------------------------------------ */
/* 2. I/O (Drizzle) + tick                                             */
/* ------------------------------------------------------------------ */

/** Predicado SQL: a sala é uma mesa de matchmaking. */
const IS_MATCHMADE = sql`(${roomTable.config} @> '{"matchmade":true}'::jsonb)`;

/** Humanos sentados numa sala (contagem). */
async function humansIn(db: Db, roomId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(roomPlayerTable)
    .where(eq(roomPlayerTable.roomId, roomId));
  return Number(row?.n ?? 0);
}

/** Cores humanas ocupadas numa sala. */
async function humanColors(db: Db, roomId: string): Promise<PlayerColor[]> {
  const rows = await db
    .select({ color: roomPlayerTable.color })
    .from(roomPlayerTable)
    .where(eq(roomPlayerTable.roomId, roomId));
  return rows.map((r) => r.color as PlayerColor);
}

/**
 * Entra na fila casual: reusa uma mesa matchmade em espera (com vaga) ou cria
 * uma nova (o jogador vira o "host" técnico dela). Devolve o código da sala.
 */
export async function joinQuickMatch(userId: string): Promise<{ code: string }> {
  const db = getDb();

  // Já está sentado numa mesa matchmade em espera? (idempotente)
  const mine = await db
    .select({ code: roomTable.code })
    .from(roomTable)
    .innerJoin(roomPlayerTable, eq(roomPlayerTable.roomId, roomTable.id))
    .where(and(eq(roomTable.status, 'waiting'), IS_MATCHMADE, eq(roomPlayerTable.userId, userId)))
    .limit(1);
  if (mine[0]) return { code: mine[0].code };

  // Procura uma mesa matchmade em espera com vaga (mais antiga primeiro).
  const open = await db
    .select({
      code: roomTable.code,
      max: roomTable.maxPlayers,
      cur: sql<number>`((select count(*)::int from ${roomPlayerTable} where ${roomPlayerTable.roomId} = ${roomTable.id}) + coalesce(jsonb_array_length(${roomTable.config} -> 'bots'), 0))`,
    })
    .from(roomTable)
    .where(and(eq(roomTable.status, 'waiting'), IS_MATCHMADE))
    .orderBy(asc(roomTable.createdAt));
  for (const r of open) {
    if (Number(r.cur) < r.max) {
      const j = await joinRoom(r.code, userId);
      if (j.ok) return { code: r.code };
    }
  }

  // Nenhuma disponível: cria uma nova (privada, para não poluir o lobby público).
  const room = await createRoom({
    hostUserId: userId,
    name: 'Jogo rápido',
    isPrivate: true,
    maxPlayers: DEFAULT_TUNING.target,
    boardLayout: 'standard',
    config: { matchmade: true },
  });
  return { code: room.code };
}

export type MatchmakingStatus =
  | { state: 'idle' }
  | { state: 'searching'; code: string; players: number }
  | { state: 'matched'; code: string };

/** Estado atual do jogador na fila (para o cliente que faz polling). */
export async function matchmakingStatus(userId: string): Promise<MatchmakingStatus> {
  const db = getDb();
  const [r] = await db
    .select({ code: roomTable.code, status: roomTable.status, id: roomTable.id })
    .from(roomTable)
    .innerJoin(roomPlayerTable, eq(roomPlayerTable.roomId, roomTable.id))
    .where(and(IS_MATCHMADE, eq(roomPlayerTable.userId, userId), sql`${roomTable.status} in ('waiting', 'in_progress')`))
    .orderBy(desc(roomTable.createdAt))
    .limit(1);
  if (!r) return { state: 'idle' };
  if (r.status === 'in_progress') return { state: 'matched', code: r.code };
  return { state: 'searching', code: r.code, players: await humansIn(db, r.id) };
}

/** Sai da fila (libera a vaga na mesa em espera). */
export async function leaveQuickMatch(userId: string): Promise<void> {
  const db = getDb();
  const [r] = await db
    .select({ code: roomTable.code })
    .from(roomTable)
    .innerJoin(roomPlayerTable, eq(roomPlayerTable.roomId, roomTable.id))
    .where(and(eq(roomTable.status, 'waiting'), IS_MATCHMADE, eq(roomPlayerTable.userId, userId)))
    .limit(1);
  if (r) await leaveRoom(r.code, userId);
}

/**
 * Tick do matchmaking: varre as mesas matchmade em espera e, nas que já podem
 * começar, completa com bots e liga o motor autoritativo (manager.startGame).
 * `now` injetável para testes.
 */
export async function matchmakingTick(manager: RoomManager, now = Date.now()): Promise<void> {
  const db = getDb();
  const rooms = await db
    .select({ id: roomTable.id, code: roomTable.code, config: roomTable.config, createdAt: roomTable.createdAt, max: roomTable.maxPlayers })
    .from(roomTable)
    .where(and(eq(roomTable.status, 'waiting'), IS_MATCHMADE));

  for (const r of rooms) {
    const humans = await humansIn(db, r.id);
    if (humans === 0) continue; // ninguém sentado (host saiu): deixa a limpeza normal cuidar
    const waited = now - new Date(r.createdAt).getTime();
    if (!shouldStartMatch(humans, waited)) continue;

    // Completa com bots até o alvo (respeitando o limite do mapa).
    const existingBots = botsOf(r.config);
    let colors: PlayerColor[] = [...(await humanColors(db, r.id)), ...existingBots.map((b) => b.color)];
    const bots = [...existingBots];
    const need = Math.min(botsToAdd(humans, existingBots.length), r.max - colors.length);
    for (let i = 0; i < need; i++) {
      const seat = nextSeat(colors);
      if (!seat) break;
      bots.push({ color: seat.color, name: `Bot ${seat.color}`, difficulty: 'medium' });
      colors = [...colors, seat.color];
    }
    await db.update(roomTable).set({ config: { ...((r.config ?? {}) as Record<string, unknown>), bots } }).where(eq(roomTable.id, r.id));

    if (await forceStartRoom(r.code)) {
      const gameConfig = await buildRoomConfig(r.code);
      if (gameConfig) manager.startGame(r.code, gameConfig);
    }
  }
}
