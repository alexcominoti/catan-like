/**
 * Estatísticas do perfil — dados REAIS do banco (item 4). Como ainda não
 * persistimos partidas (o jogo é local/hotseat por ora), na prática isto retorna
 * zeros e uma lista vazia até existir gravação de partidas; a UI mostra o estado
 * vazio ("Sem partidas ainda") em vez de números mockados.
 */
import { desc, eq, sql } from 'drizzle-orm';
import {
  getDb,
  match as matchTable,
  matchPlayer as matchPlayerTable,
  playerStats as playerStatsTable,
  user as userTable,
} from '@trevalis/db';

/**
 * Perfil PUBLICO (compartilhavel via `/profile/:username`, sem exigir login).
 * Resolve o username (case-insensitive) para um userId e reusa `getProfileStats`.
 * `null` se o username nao existe.
 */
export async function getPublicProfileByUsername(
  username: string,
): Promise<{ username: string; stats: ProfileStats } | null> {
  const db = getDb();
  const [u] = await db
    .select({ id: userTable.id, username: sql<string>`coalesce(${userTable.username}, ${userTable.name})` })
    .from(userTable)
    .where(sql`lower(coalesce(${userTable.username}, ${userTable.name})) = lower(${username})`)
    .limit(1);
  if (!u) return null;
  return { username: u.username, stats: await getProfileStats(u.id) };
}

export interface ProfileMatch {
  won: boolean;
  points: number;
  map: string | null;
  opponents: string[];
  finishedAt: string | null;
}

export interface ProfileStats {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  longestStreak: number;
  matches: ProfileMatch[];
}

/** Estatísticas agregadas + últimas 5 partidas de um usuário. */
export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const db = getDb();

  const [stats] = await db
    .select({
      gamesPlayed: playerStatsTable.gamesPlayed,
      gamesWon: playerStatsTable.gamesWon,
      currentStreak: playerStatsTable.currentStreak,
      longestStreak: playerStatsTable.longestStreak,
    })
    .from(playerStatsTable)
    .where(eq(playerStatsTable.userId, userId))
    .limit(1);

  // Últimas 5 partidas com participação deste usuário.
  const mine = await db
    .select({
      matchId: matchPlayerTable.matchId,
      points: matchPlayerTable.points,
      won: matchPlayerTable.won,
      config: matchTable.config,
      finishedAt: matchTable.finishedAt,
    })
    .from(matchPlayerTable)
    .innerJoin(matchTable, eq(matchTable.id, matchPlayerTable.matchId))
    .where(eq(matchPlayerTable.userId, userId))
    .orderBy(desc(matchTable.finishedAt))
    .limit(5);

  const matches: ProfileMatch[] = [];
  for (const m of mine) {
    const opp = await db
      .select({
        username: sql<string>`coalesce(${userTable.username}, ${userTable.name})`,
      })
      .from(matchPlayerTable)
      .innerJoin(userTable, eq(userTable.id, matchPlayerTable.userId))
      .where(sql`${matchPlayerTable.matchId} = ${m.matchId} and ${matchPlayerTable.userId} <> ${userId}`);
    const cfg = (m.config ?? {}) as { boardLayout?: string };
    matches.push({
      won: m.won,
      points: m.points,
      map: cfg.boardLayout ?? null,
      opponents: opp.map((o) => o.username),
      finishedAt: m.finishedAt ? new Date(m.finishedAt).toISOString() : null,
    });
  }

  return {
    gamesPlayed: stats?.gamesPlayed ?? 0,
    gamesWon: stats?.gamesWon ?? 0,
    currentStreak: stats?.currentStreak ?? 0,
    longestStreak: stats?.longestStreak ?? 0,
    matches,
  };
}
