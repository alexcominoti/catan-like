/**
 * Cliente das rotas sociais (amigos + presença). Mesma origem, cookies de sessão
 * vão junto. Alimenta a página de Amigos, o contador de online da landing e o
 * heartbeat de presença.
 */

export interface FriendView {
  userId: string;
  username: string;
  online: boolean;
  /** Sala em que o amigo está agora (link "Entrar/Assistir"), ou null. */
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
  blocked: PendingView[];
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** Lista amigos (aceitos) + pedidos pendentes recebidos/enviados. */
export async function getFriends(): Promise<FriendsPayload> {
  const empty: FriendsPayload = { friends: [], incoming: [], outgoing: [], blocked: [] };
  const res = await fetch('/api/friends');
  if (!res.ok) return empty;
  return (await res.json().catch(() => empty)) as FriendsPayload;
}

export type SocialResult = { ok: true } | { ok: false; error: string };

async function post(url: string, body: Record<string, unknown>): Promise<SocialResult> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: 'Falha de conexão.' };
  }
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: data.error ?? 'Erro inesperado.' };
}

/** Envia um pedido de amizade por nome de usuário. */
export function sendFriendRequest(username: string): Promise<SocialResult> {
  return post('/api/friends/request', { username });
}

/** Aceita um pedido recebido. */
export function acceptFriend(userId: string): Promise<SocialResult> {
  return post('/api/friends/accept', { userId });
}

/** Remove/recusa/cancela a relação com um usuário. */
export function removeFriend(userId: string): Promise<SocialResult> {
  return post('/api/friends/remove', { userId });
}

/** Bloqueia um usuário (por username) — esconde mensagens dele e impede que te adicione. */
export function blockUser(username: string): Promise<SocialResult> {
  return post('/api/friends/block', { username });
}

/** Desbloqueia um usuário (por userId). */
export function unblockUser(userId: string): Promise<SocialResult> {
  return post('/api/friends/unblock', { userId });
}

/** Denuncia um jogador (por username), opcionalmente com a sala e um motivo. */
export function reportUser(username: string, code?: string, reason?: string): Promise<SocialResult> {
  return post('/api/reports', { username, code, reason });
}

/** Contador público de jogadores online (landing) — 0 em caso de erro. */
export async function getOnlineCount(): Promise<number> {
  try {
    const res = await fetch('/api/presence');
    if (!res.ok) return 0;
    const data = (await res.json().catch(() => ({}))) as { online?: number };
    return typeof data.online === 'number' ? data.online : 0;
  } catch {
    return 0;
  }
}

/* ---- Notificações persistentes (Tier 2) ---- */

export type NotificationType = 'room_invite' | 'friend_request' | 'friend_accepted';

/** Uma notificação persistida (lida/não-lida, com data). `AppNotification` para
 *  não colidir com o global `Notification` do navegador. */
export interface AppNotification {
  id: string;
  type: NotificationType;
  actorId: string | null;
  actorUsername: string | null;
  data: { code?: string } | null;
  read: boolean;
  createdAt: string; // ISO 8601
}

/** Uma partida em andamento à qual posso reconectar. */
export interface RejoinRoom {
  code: string;
  name: string;
  /** Prazo (ISO) até quando ainda dá para reconectar; null = sem contador. */
  deadlineAt: string | null;
}

export interface Notifications {
  /** Feed persistido (convites, pedidos, "aceitou"), mais recentes primeiro. */
  notifications: AppNotification[];
  onlineFriends: FriendView[];
  rejoin: RejoinRoom[];
  /** Não-lidas (badge do sino). */
  unreadCount: number;
}

const EMPTY_NOTIFS: Notifications = { notifications: [], onlineFriends: [], rejoin: [], unreadCount: 0 };

/** Agregado do sino: feed persistido + amigos online + salas para reconectar. */
export async function getNotifications(): Promise<Notifications> {
  try {
    const res = await fetch('/api/notifications');
    if (!res.ok) return EMPTY_NOTIFS;
    return (await res.json().catch(() => EMPTY_NOTIFS)) as Notifications;
  } catch {
    return EMPTY_NOTIFS;
  }
}

/** Convida um amigo (por userId) para a sala `code`. */
export function sendInvite(toUserId: string, code: string): Promise<SocialResult> {
  return post('/api/invites', { toUserId, code });
}

/** Marca UMA notificação como lida. */
export async function markNotificationRead(id: string): Promise<void> {
  try {
    await fetch('/api/notifications/read', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id }) });
  } catch {
    /* best-effort */
  }
}

/** Marca TODAS as notificações como lidas. */
export async function markAllNotificationsRead(): Promise<void> {
  try {
    await fetch('/api/notifications/read-all', { method: 'POST', headers: JSON_HEADERS });
  } catch {
    /* best-effort */
  }
}

/* ---- Matchmaking "Jogo rápido" (Tier 2) ---- */

export type MatchmakingStatus =
  | { state: 'idle' }
  | { state: 'searching'; code: string; players: number }
  | { state: 'matched'; code: string };

/** Entra na fila casual; devolve o código da mesa (ou null em erro). */
export async function joinQuickMatch(): Promise<string | null> {
  try {
    const res = await fetch('/api/matchmaking/join', { method: 'POST', headers: JSON_HEADERS });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { code?: string };
    return data.code ?? null;
  } catch {
    return null;
  }
}

/** Estado atual na fila (polling do cliente). */
export async function getMatchmakingStatus(): Promise<MatchmakingStatus> {
  try {
    const res = await fetch('/api/matchmaking/status');
    if (!res.ok) return { state: 'idle' };
    return (await res.json().catch(() => ({ state: 'idle' }))) as MatchmakingStatus;
  } catch {
    return { state: 'idle' };
  }
}

/** Sai da fila. */
export async function leaveQuickMatch(): Promise<void> {
  try {
    await fetch('/api/matchmaking/leave', { method: 'POST', headers: JSON_HEADERS });
  } catch {
    /* best-effort */
  }
}

/** Heartbeat: marca o usuário logado como online (com a sala atual, se houver). */
export async function pingPresence(room: string | null = null): Promise<void> {
  try {
    await fetch('/api/presence/ping', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ room }),
    });
  } catch {
    /* best-effort */
  }
}
