/**
 * Persistência restart-safe do GameState VIVO (I/O no banco).
 *
 * O motor autoritativo (GameRoom) vive só na memória do servidor — um deploy ou
 * queda de máquina derrubava as partidas em andamento. Aqui gravamos o estado
 * completo (JSON) por `room_code` (com debounce, do lado do server.ts) e o
 * restauramos ao reconectar. O estado é o AUTORITATIVO (sem fog of war); a
 * projeção por jogador acontece na hora de enviar.
 *
 * Tudo aqui exige banco (`DATABASE_URL`); o server.ts protege as chamadas com
 * `hasDatabase()` e injeta estas funções como deps (testável sem banco real).
 */
import { eq } from 'drizzle-orm';
import { getDb, gameSnapshot as snapTable, room as roomTable } from '@trevalis/db';
import type { GameState } from '@trevalis/engine';
import type { RoomConfig } from './protocol.js';
import { buildRoomConfig } from './rooms.js';

/** Grava (ou sobrescreve) o snapshot da sala. Upsert por `room_code`. */
export async function saveGameSnapshot(code: string, state: GameState): Promise<void> {
  const db = getDb();
  const value = state as unknown as Record<string, unknown>;
  const now = new Date();
  await db
    .insert(snapTable)
    .values({ roomCode: code, state: value, updatedAt: now })
    .onConflictDoUpdate({ target: snapTable.roomCode, set: { state: value, updatedAt: now } });
}

/** Apaga o snapshot da sala (ao terminar/abandonar a partida). */
export async function deleteGameSnapshot(code: string): Promise<void> {
  const db = getDb();
  await db.delete(snapTable).where(eq(snapTable.roomCode, code));
}

/** Lê o snapshot salvo de uma sala, ou null se não houver. */
export async function loadGameSnapshot(code: string): Promise<GameState | null> {
  const db = getDb();
  const [row] = await db
    .select({ state: snapTable.state })
    .from(snapTable)
    .where(eq(snapTable.roomCode, code))
    .limit(1);
  return row ? (row.state as unknown as GameState) : null;
}

/**
 * Para o WS `enter`: se a sala está `in_progress`, devolve o `config` (reconstruído
 * dos metadados duráveis) + o `state` salvo (se houver). Assim o servidor recria o
 * GameRoom após um restart. Sem snapshot ainda (partida recém-iniciada, antes do 1º
 * save) o `state` vem indefinido → o chamador recria uma partida nova do config.
 * `null` se a sala não é restaurável (waiting/finished/abandoned/sem config).
 */
export async function loadGameForEnter(
  code: string,
): Promise<{ config: RoomConfig; state?: GameState } | null> {
  const db = getDb();
  const [r] = await db
    .select({ status: roomTable.status })
    .from(roomTable)
    .where(eq(roomTable.code, code))
    .limit(1);
  if (!r || r.status !== 'in_progress') return null;
  const config = await buildRoomConfig(code);
  if (!config) return null;
  const state = (await loadGameSnapshot(code)) ?? undefined;
  return { config, state };
}
