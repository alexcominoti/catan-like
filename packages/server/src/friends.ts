/**
 * Sistema de amigos (Tier 1, item 2) — a cola social.
 *
 * Modelo: `friendship` é uma aresta direcionada (requester → addressee) com
 * status 'pending' | 'accepted' | 'blocked'. Uma amizade aceita é uma única
 * aresta 'accepted' (em qualquer direção). Pedido recíproco é auto-aceito
 * (como no Colonist). Presença (online/sala) vem do PresenceTracker em memória.
 *
 * Dividido em NÚCLEO PURO (decisão de pedido, testável) + I/O (Drizzle).
 */
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb, friendship as friendshipTable, user as userTable } from '@trevalis/db';
import { presence } from './presence.js';
import { addNotification, resolveFriendRequest } from './notifications.js';

/* ------------------------------------------------------------------ */
/* 1. Núcleo puro (testável, sem banco)                                */
/* ------------------------------------------------------------------ */

export interface FriendEdge {
  requesterId: string;
  addresseeId: string;
  status: string;
}

export type FriendDecision =
  | { action: 'create' } // nenhuma aresta: cria pedido pendente
  | { action: 'accept-existing' } // já havia pedido recíproco: aceita-o
  | { action: 'noop'; reason: string }; // já amigos / já enviado / bloqueado / self

/**
 * Decide o que fazer ao enviar um pedido de `fromId` para `toId`, dadas as
 * arestas já existentes entre os dois (qualquer direção). Puro.
 */
export function decideFriendRequest(
  edges: readonly FriendEdge[],
  fromId: string,
  toId: string,
): FriendDecision {
  if (fromId === toId) return { action: 'noop', reason: 'Você não pode adicionar a si mesmo.' };
  const forward = edges.find((e) => e.requesterId === fromId && e.addresseeId === toId);
  const reverse = edges.find((e) => e.requesterId === toId && e.addresseeId === fromId);
  if (forward?.status === 'accepted' || reverse?.status === 'accepted') {
    return { action: 'noop', reason: 'Vocês já são amigos.' };
  }
  if (forward?.status === 'blocked' || reverse?.status === 'blocked') {
    return { action: 'noop', reason: 'Não é possível enviar o pedido.' };
  }
  if (reverse?.status === 'pending') return { action: 'accept-existing' };
  if (forward?.status === 'pending') return { action: 'noop', reason: 'Pedido já enviado.' };
  return { action: 'create' };
}

/* ------------------------------------------------------------------ */
/* 2. I/O no banco                                                     */
/* ------------------------------------------------------------------ */

export interface FriendView {
  userId: string;
  username: string;
  online: boolean;
  /** Sala em que o amigo está agora (para "Entrar/Assistir"), ou null. */
  room: string | null;
}

export interface PendingView {
  userId: string;
  username: string;
}

export interface FriendsPayload {
  friends: FriendView[];
  incoming: PendingView[];
  outgoing: PendingView[];
  /** Usuários que EU bloqueei (não vejo mensagens deles). */
  blocked: PendingView[];
}

const USERNAME = sql<string>`coalesce(${userTable.username}, ${userTable.name})`;

/** Resolve um username (case-insensitive) para { id, username }, ou null. */
async function resolveUsername(username: string): Promise<{ id: string; username: string } | null> {
  const db = getDb();
  const [u] = await db
    .select({ id: userTable.id, username: USERNAME })
    .from(userTable)
    .where(sql`lower(coalesce(${userTable.username}, ${userTable.name})) = lower(${username})`)
    .limit(1);
  return u ?? null;
}

export type FriendActionResult =
  | { ok: true }
  | { ok: false; error: string; httpStatus: number };

/** Envia (ou auto-aceita) um pedido de amizade para um username. */
export async function sendFriendRequest(fromUserId: string, toUsername: string): Promise<FriendActionResult> {
  const target = await resolveUsername(toUsername.trim());
  if (!target) return { ok: false, error: 'Usuário não encontrado.', httpStatus: 404 };

  const db = getDb();
  const edges = await db
    .select({
      requesterId: friendshipTable.requesterId,
      addresseeId: friendshipTable.addresseeId,
      status: friendshipTable.status,
    })
    .from(friendshipTable)
    .where(
      or(
        and(eq(friendshipTable.requesterId, fromUserId), eq(friendshipTable.addresseeId, target.id)),
        and(eq(friendshipTable.requesterId, target.id), eq(friendshipTable.addresseeId, fromUserId)),
      ),
    );

  const decision = decideFriendRequest(edges, fromUserId, target.id);
  if (decision.action === 'noop') return { ok: false, error: decision.reason, httpStatus: 409 };

  if (decision.action === 'accept-existing') {
    await db
      .update(friendshipTable)
      .set({ status: 'accepted' })
      .where(and(eq(friendshipTable.requesterId, target.id), eq(friendshipTable.addresseeId, fromUserId)));
    // Eu aceitei (re-pedindo) o pedido do target: avisa-o e resolve o "toque"
    // que eu havia recebido dele.
    await resolveFriendRequest(fromUserId, target.id);
    await addNotification(target.id, 'friend_accepted', fromUserId);
    return { ok: true };
  }

  await db.insert(friendshipTable).values({ requesterId: fromUserId, addresseeId: target.id, status: 'pending' });
  await addNotification(target.id, 'friend_request', fromUserId);
  return { ok: true };
}

/** Aceita um pedido pendente recebido (o outro usuário havia pedido). */
export async function acceptFriendRequest(userId: string, otherUserId: string): Promise<FriendActionResult> {
  const db = getDb();
  const updated = await db
    .update(friendshipTable)
    .set({ status: 'accepted' })
    .where(
      and(
        eq(friendshipTable.requesterId, otherUserId),
        eq(friendshipTable.addresseeId, userId),
        eq(friendshipTable.status, 'pending'),
      ),
    )
    .returning({ requesterId: friendshipTable.requesterId });
  if (updated.length === 0) return { ok: false, error: 'Pedido não encontrado.', httpStatus: 404 };
  // Resolve o pedido que eu recebia e avisa o outro que aceitei.
  await resolveFriendRequest(userId, otherUserId);
  await addNotification(otherUserId, 'friend_accepted', userId);
  return { ok: true };
}

/**
 * Remove a relação com outro usuário — serve para desfazer amizade, recusar um
 * pedido recebido ou cancelar um enviado (apaga a aresta em qualquer direção).
 */
export async function removeFriend(userId: string, otherUserId: string): Promise<FriendActionResult> {
  const db = getDb();
  await db.delete(friendshipTable).where(
    or(
      and(eq(friendshipTable.requesterId, userId), eq(friendshipTable.addresseeId, otherUserId)),
      and(eq(friendshipTable.requesterId, otherUserId), eq(friendshipTable.addresseeId, userId)),
    ),
  );
  // Recusar/cancelar um pedido também tira o "toque" de qualquer direção.
  await resolveFriendRequest(userId, otherUserId);
  await resolveFriendRequest(otherUserId, userId);
  return { ok: true };
}

/**
 * Bloqueia um usuário (por username): apaga qualquer relação existente e grava uma
 * aresta 'blocked' de mim para ele. Bloquear impede que ele me adicione (o
 * `decideFriendRequest` trata 'blocked' como noop) e esconde as mensagens dele.
 */
export async function blockUser(userId: string, targetUsername: string): Promise<FriendActionResult> {
  const target = await resolveUsername(targetUsername.trim());
  if (!target) return { ok: false, error: 'Usuário não encontrado.', httpStatus: 404 };
  if (target.id === userId) return { ok: false, error: 'Você não pode se bloquear.', httpStatus: 409 };
  const db = getDb();
  await db.delete(friendshipTable).where(
    or(
      and(eq(friendshipTable.requesterId, userId), eq(friendshipTable.addresseeId, target.id)),
      and(eq(friendshipTable.requesterId, target.id), eq(friendshipTable.addresseeId, userId)),
    ),
  );
  await db.insert(friendshipTable).values({ requesterId: userId, addresseeId: target.id, status: 'blocked' });
  return { ok: true };
}

/** Desbloqueia um usuário (remove a aresta 'blocked' que eu criei). */
export async function unblockUser(userId: string, otherUserId: string): Promise<FriendActionResult> {
  const db = getDb();
  await db
    .delete(friendshipTable)
    .where(
      and(
        eq(friendshipTable.requesterId, userId),
        eq(friendshipTable.addresseeId, otherUserId),
        eq(friendshipTable.status, 'blocked'),
      ),
    );
  return { ok: true };
}

/** Amigos (aceitos) + pedidos pendentes recebidos/enviados, com presença online. */
export async function listFriends(userId: string): Promise<FriendsPayload> {
  const db = getDb();

  // Amigos aceitos: o "outro lado" da aresta, em qualquer direção.
  const otherId = sql<string>`case when ${friendshipTable.requesterId} = ${userId} then ${friendshipTable.addresseeId} else ${friendshipTable.requesterId} end`;
  const accepted = await db
    .select({ userId: otherId, username: USERNAME })
    .from(friendshipTable)
    .innerJoin(userTable, sql`${userTable.id} = ${otherId}`)
    .where(
      and(
        eq(friendshipTable.status, 'accepted'),
        or(eq(friendshipTable.requesterId, userId), eq(friendshipTable.addresseeId, userId)),
      ),
    );

  const incoming = await db
    .select({ userId: friendshipTable.requesterId, username: USERNAME })
    .from(friendshipTable)
    .innerJoin(userTable, eq(userTable.id, friendshipTable.requesterId))
    .where(and(eq(friendshipTable.addresseeId, userId), eq(friendshipTable.status, 'pending')));

  const outgoing = await db
    .select({ userId: friendshipTable.addresseeId, username: USERNAME })
    .from(friendshipTable)
    .innerJoin(userTable, eq(userTable.id, friendshipTable.addresseeId))
    .where(and(eq(friendshipTable.requesterId, userId), eq(friendshipTable.status, 'pending')));

  // Usuários que EU bloqueei (aresta 'blocked' de mim para eles).
  const blocked = await db
    .select({ userId: friendshipTable.addresseeId, username: USERNAME })
    .from(friendshipTable)
    .innerJoin(userTable, eq(userTable.id, friendshipTable.addresseeId))
    .where(and(eq(friendshipTable.requesterId, userId), eq(friendshipTable.status, 'blocked')));

  const friends: FriendView[] = accepted
    .map((f) => ({
      userId: f.userId,
      username: f.username,
      online: presence.isOnline(f.userId),
      room: presence.roomOf(f.userId),
    }))
    // Online primeiro, depois alfabético.
    .sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));

  return { friends, incoming, outgoing, blocked };
}
