/**
 * Gravação de partidas → estatísticas/perfil reais (Tier 1, item 1).
 *
 * Quando uma partida termina (`state.phase === 'ended'`), o servidor persiste:
 *  - `match`         — uma linha por jogo (seed + config resumida + vencedor).
 *  - `match_player`  — participação de cada HUMANO (cor, pontos, venceu).
 *  - `player_stats`  — agregados por usuário (jogos, vitórias, sequência, karma).
 *
 * Só humanos entram em `match_player`/`player_stats` (bots não têm conta). Quem
 * abandonou (a vaga virou bot antes do fim) conta como partida ABANDONADA para o
 * karma; quem chegou conectado ao fim conta como CONCLUÍDA. Ver karma.ts.
 *
 * Dividido em NÚCLEO PURO (testável, sem I/O) + persistência (Drizzle).
 */
import { scoreOf, type GameState, type PlayerColor } from '@trevalis/engine';
import {
  getDb,
  match as matchTable,
  matchPlayer as matchPlayerTable,
  playerStats as playerStatsTable,
  room as roomTable,
} from '@trevalis/db';
import { eq } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* 1. Núcleo puro (testável, sem banco)                                */
/* ------------------------------------------------------------------ */

/** Resultado de um humano numa partida encerrada. */
export interface MatchPlayerResult {
  userId: string;
  color: PlayerColor;
  points: number;
  won: boolean;
  /** A vaga virou bot antes do fim (abandono) — penaliza o karma. */
  abandoned: boolean;
}

/** Resumo de uma partida encerrada, pronto para persistir. */
export interface MatchSummary {
  seed: number;
  config: { boardLayout: string; pace: string; pointsToWin: number };
  winnerUserId: string | null;
  players: MatchPlayerResult[];
}

/** Assento humano de uma sala (o que a GameRoom expõe em `humans`). */
export interface HumanSeat {
  color: PlayerColor;
  name: string;
  userId: string;
}

/**
 * Resume uma partida encerrada a partir do estado final + dos assentos humanos +
 * das cores que terminaram "ausentes" (pilotadas por bot = abandono). Puro: usa
 * o `scoreOf` do engine (estado NÃO projetado → pontuação real, com PV ocultos).
 */
export function summarizeMatch(
  state: GameState,
  humans: readonly HumanSeat[],
  awayColors: readonly PlayerColor[],
  config: { seed: number; boardLayout: string; pace: string; pointsToWin: number },
): MatchSummary {
  const winnerColor = state.winner;
  const away = new Set(awayColors);
  const players: MatchPlayerResult[] = humans.map((h) => ({
    userId: h.userId,
    color: h.color,
    points: scoreOf(state, h.color),
    won: h.color === winnerColor,
    abandoned: away.has(h.color),
  }));
  const winnerUserId = humans.find((h) => h.color === winnerColor)?.userId ?? null;
  return {
    seed: config.seed,
    config: { boardLayout: config.boardLayout, pace: config.pace, pointsToWin: config.pointsToWin },
    winnerUserId,
    players,
  };
}

/** Contadores agregados de um jogador (o que vive em `player_stats`). */
export interface StatsCounters {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  longestStreak: number;
  gamesCompleted: number;
  gamesAbandoned: number;
}

export const ZERO_STATS: StatsCounters = {
  gamesPlayed: 0,
  gamesWon: 0,
  currentStreak: 0,
  longestStreak: 0,
  gamesCompleted: 0,
  gamesAbandoned: 0,
};

/**
 * Aplica o resultado de UMA partida aos contadores agregados (puro). Sequência:
 * cresce a cada vitória, zera na derrota; o recorde nunca diminui. Karma: cada
 * partida conta como concluída OU abandonada (nunca as duas).
 */
export function applyStatsDelta(
  prev: StatsCounters,
  result: { won: boolean; abandoned: boolean },
): StatsCounters {
  const currentStreak = result.won ? prev.currentStreak + 1 : 0;
  return {
    gamesPlayed: prev.gamesPlayed + 1,
    gamesWon: prev.gamesWon + (result.won ? 1 : 0),
    currentStreak,
    longestStreak: Math.max(prev.longestStreak, currentStreak),
    gamesCompleted: prev.gamesCompleted + (result.abandoned ? 0 : 1),
    gamesAbandoned: prev.gamesAbandoned + (result.abandoned ? 1 : 0),
  };
}

/* ------------------------------------------------------------------ */
/* 2. Persistência (Drizzle)                                           */
/* ------------------------------------------------------------------ */

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

/**
 * Persiste uma partida encerrada: grava `match` + `match_player`, atualiza
 * `player_stats` de cada humano (read-modify-write via `applyStatsDelta`) e liga
 * a sala ao registro da partida (`room.match_id`). Sem humanos → não faz nada
 * (partida só de bots não gera histórico). Idempotência é garantida por quem
 * chama (o servidor só dispara uma vez por partida, via `finishNotified`).
 */
export async function persistMatch(code: string, summary: MatchSummary): Promise<void> {
  if (summary.players.length === 0) return; // só bots: sem histórico
  const db = getDb();
  const now = new Date();
  const matchId = genId();

  await db.insert(matchTable).values({
    id: matchId,
    seed: summary.seed,
    config: summary.config,
    status: 'finished',
    winnerUserId: summary.winnerUserId,
    startedAt: now,
    finishedAt: now,
  });

  await db.insert(matchPlayerTable).values(
    summary.players.map((p) => ({
      matchId,
      userId: p.userId,
      color: p.color,
      points: p.points,
      won: p.won,
    })),
  );

  for (const p of summary.players) {
    const [prev] = await db
      .select({
        gamesPlayed: playerStatsTable.gamesPlayed,
        gamesWon: playerStatsTable.gamesWon,
        currentStreak: playerStatsTable.currentStreak,
        longestStreak: playerStatsTable.longestStreak,
        gamesCompleted: playerStatsTable.gamesCompleted,
        gamesAbandoned: playerStatsTable.gamesAbandoned,
      })
      .from(playerStatsTable)
      .where(eq(playerStatsTable.userId, p.userId))
      .limit(1);
    const next = applyStatsDelta(prev ?? ZERO_STATS, { won: p.won, abandoned: p.abandoned });
    await db
      .insert(playerStatsTable)
      .values({ userId: p.userId, ...next, updatedAt: now })
      .onConflictDoUpdate({ target: playerStatsTable.userId, set: { ...next, updatedAt: now } });
  }

  // Liga a sala ao registro da partida (histórico acessível pelo link da sala).
  await db.update(roomTable).set({ matchId }).where(eq(roomTable.code, code));
}
