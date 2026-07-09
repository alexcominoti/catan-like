/**
 * Notificações persistentes (sino do header) — substitui o antigo InviteStore em
 * memória. Uma linha por evento entregue a um usuário, com estado lido/não-lido
 * (`readAt`), data (`createdAt`) e expiração de 30 dias (poda lazy na leitura).
 * Alimentado pelos handlers de convite (http.ts) e amizade (friends.ts).
 *
 * Reconectar e amigos online NÃO passam por aqui — são estados ao vivo/derivados.
 *
 * Núcleo PURO (`isExpired`) separado do I/O Drizzle: o CI não tem Postgres, então
 * só o núcleo é testado em unidade (ver notifications.test.ts); o caminho de banco
 * é validado por E2E manual / preview.
 */
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { getDb, notification as notif, user as userTable } from '@trevalis/db';

export type NotificationType = 'room_invite' | 'friend_request' | 'friend_accepted';

/** Janela de retenção: notificações somem após 30 dias. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Núcleo puro (testável sem banco): a notificação passou da janela de 30 dias? */
export function isExpired(createdAt: Date, now: Date = new Date(), retentionMs = RETENTION_MS): boolean {
  return now.getTime() - createdAt.getTime() > retentionMs;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  actorId: string | null;
  actorUsername: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string; // ISO 8601
}

const USERNAME = sql<string>`coalesce(${userTable.username}, ${userTable.name})`;

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

/** Poda lazy: apaga o que passou de 30 dias (chamada na listagem). */
async function prune(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  await getDb().delete(notif).where(and(eq(notif.userId, userId), lt(notif.createdAt, cutoff)));
}

/**
 * Registra uma notificação para `userId`. Para 'room_invite' faz DEDUP: se já há
 * um convite do mesmo actor para a mesma sala, apenas o "reativa" (renova a data e
 * volta a não-lido) em vez de duplicar — como fazia o InviteStore. Nunca notifica
 * a si mesmo.
 */
export async function addNotification(
  userId: string,
  type: NotificationType,
  actorId: string | null,
  data?: Record<string, unknown>,
): Promise<void> {
  if (actorId && actorId === userId) return;
  const db = getDb();

  if (type === 'room_invite' && actorId && data?.code) {
    const code = String(data.code);
    const [existing] = await db
      .select({ id: notif.id })
      .from(notif)
      .where(
        and(
          eq(notif.userId, userId),
          eq(notif.type, 'room_invite'),
          eq(notif.actorId, actorId),
          sql`${notif.data} ->> 'code' = ${code}`,
        ),
      )
      .limit(1);
    if (existing) {
      await db.update(notif).set({ createdAt: new Date(), readAt: null, data }).where(eq(notif.id, existing.id));
      return;
    }
  }

  await db.insert(notif).values({ id: genId(), userId, type, actorId, data, createdAt: new Date() });
}

/** Feed do usuário (30 dias), mais recentes primeiro, com o username do actor. */
export async function listNotifications(userId: string): Promise<NotificationView[]> {
  await prune(userId);
  const rows = await getDb()
    .select({
      id: notif.id,
      type: notif.type,
      actorId: notif.actorId,
      actorUsername: USERNAME,
      data: notif.data,
      readAt: notif.readAt,
      createdAt: notif.createdAt,
    })
    .from(notif)
    .leftJoin(userTable, eq(userTable.id, notif.actorId))
    .where(eq(notif.userId, userId))
    .orderBy(desc(notif.createdAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    type: r.type as NotificationType,
    actorId: r.actorId,
    actorUsername: r.actorUsername ?? null,
    data: (r.data as Record<string, unknown> | null) ?? null,
    read: r.readAt != null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Quantas não-lidas (badge do sino). */
export async function unreadCount(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(notif)
    .where(and(eq(notif.userId, userId), isNull(notif.readAt)));
  return row?.n ?? 0;
}

/** Marca UMA notificação como lida (só do próprio usuário). */
export async function markRead(userId: string, id: string): Promise<void> {
  await getDb()
    .update(notif)
    .set({ readAt: new Date() })
    .where(and(eq(notif.userId, userId), eq(notif.id, id), isNull(notif.readAt)));
}

/** Marca TODAS as não-lidas do usuário como lidas ("marcar todas como lidas"). */
export async function markAllRead(userId: string): Promise<void> {
  await getDb()
    .update(notif)
    .set({ readAt: new Date() })
    .where(and(eq(notif.userId, userId), isNull(notif.readAt)));
}

/**
 * Remove a notificação de pedido de amizade que `userId` recebeu de `actorId` —
 * usada quando o pedido é aceito, recusado ou cancelado (o "toque" perdeu sentido).
 */
export async function resolveFriendRequest(userId: string, actorId: string): Promise<void> {
  await getDb()
    .delete(notif)
    .where(and(eq(notif.userId, userId), eq(notif.type, 'friend_request'), eq(notif.actorId, actorId)));
}
