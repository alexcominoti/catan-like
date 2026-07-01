/**
 * Cliente das rotas REST de salas (camada de metadados — item 2). Conversa com o
 * servidor na MESMA origem; os cookies de sessão (Better Auth) vão junto.
 */

export interface RoomListItem {
  code: string;
  name: string;
  host: string;
  boardLayout: string;
  cur: number;
  max: number;
}

export interface RoomPlayerView {
  username: string;
  color: string;
  isHost: boolean;
}

export interface RoomView {
  code: string;
  name: string;
  status: 'waiting' | 'in_progress' | 'finished' | 'abandoned';
  isPrivate: boolean;
  maxPlayers: number;
  boardLayout: string;
  hostUserId: string;
  isHost: boolean;
  players: RoomPlayerView[];
}

/** Resultado de uma ação de sala: sucesso com a sala, ou erro legível + status. */
export type RoomResult =
  | { ok: true; room: RoomView }
  | { ok: false; error: string; status: number };

async function roomCall(url: string, init?: RequestInit): Promise<RoomResult> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, error: 'Falha de conexão.', status: 0 };
  }
  const data = (await res.json().catch(() => ({}))) as { room?: RoomView; error?: string };
  if (!res.ok || !data.room) {
    return { ok: false, error: data.error ?? 'Erro inesperado.', status: res.status };
  }
  return { ok: true, room: data.room };
}

/** Lista as salas públicas abertas (waiting + não privadas). */
export async function listRooms(): Promise<RoomListItem[]> {
  const res = await fetch('/api/rooms');
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { rooms?: RoomListItem[] };
  return data.rooms ?? [];
}

export interface CreateRoomPayload {
  name: string;
  isPrivate: boolean;
  maxPlayers: number;
  boardLayout: string;
  config?: Record<string, unknown>;
}

export function createRoomApi(payload: CreateRoomPayload): Promise<RoomResult> {
  return roomCall('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getRoomApi(code: string): Promise<RoomResult> {
  return roomCall(`/api/rooms/${encodeURIComponent(code)}`);
}

export function joinRoomApi(code: string): Promise<RoomResult> {
  return roomCall(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST' });
}

export function startRoomApi(code: string): Promise<RoomResult> {
  return roomCall(`/api/rooms/${encodeURIComponent(code)}/start`, { method: 'POST' });
}

/** URL compartilhável do link único da sala. */
export function roomLink(code: string): string {
  return `${window.location.origin}/sala/${code}`;
}
