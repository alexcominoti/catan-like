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
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** Lista amigos (aceitos) + pedidos pendentes recebidos/enviados. */
export async function getFriends(): Promise<FriendsPayload> {
  const res = await fetch('/api/friends');
  if (!res.ok) return { friends: [], incoming: [], outgoing: [] };
  return (await res.json().catch(() => ({ friends: [], incoming: [], outgoing: [] }))) as FriendsPayload;
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
