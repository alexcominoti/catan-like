/**
 * Denúncias de jogadores (moderação). Grava numa tabela para revisão manual —
 * sem UI de admin ainda, mas a infraestrutura persiste (não some no restart).
 */
import { sql } from 'drizzle-orm';
import { getDb, report as reportTable, user as userTable } from '@trevalis/db';

export type ReportResult = { ok: true } | { ok: false; error: string; httpStatus: number };

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

/** Registra uma denúncia de `reporterId` contra `targetUsername` (opcional: sala + motivo). */
export async function reportUser(
  reporterId: string,
  targetUsername: string,
  roomCode: string | null,
  reason: string | null,
): Promise<ReportResult> {
  const db = getDb();
  const [target] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(sql`lower(coalesce(${userTable.username}, ${userTable.name})) = lower(${targetUsername.trim()})`)
    .limit(1);
  if (!target) return { ok: false, error: 'Usuário não encontrado.', httpStatus: 404 };
  if (target.id === reporterId) return { ok: false, error: 'Você não pode se denunciar.', httpStatus: 409 };

  await db.insert(reportTable).values({
    id: genId(),
    reporterId,
    targetId: target.id,
    roomCode: roomCode ?? null,
    reason: reason ? reason.slice(0, 300) : null,
  });
  return { ok: true };
}
