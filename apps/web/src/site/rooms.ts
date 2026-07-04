/**
 * Cliente das rotas REST de salas. Conversa com o servidor na MESMA origem; os
 * cookies de sessão (Better Auth) vão junto. A sala é estado VIVO no servidor: o
 * anfitrião edita regras/bots e convidados entram/saem até "Começar partida".
 */

export interface RoomListItem {
  code: string;
  name: string;
  host: string;
  boardLayout: string;
  cur: number;
  max: number;
}

export type BotDifficulty = 'easy' | 'medium' | 'hard';

/** Um assento ocupado na sala de espera: humano (host/convidado) OU bot. */
export interface RoomSeatView {
  name: string;
  color: string;
  isHost: boolean;
  isBot: boolean;
  difficulty?: BotDifficulty;
}

/** Regras da partida que o anfitrião ajusta ao vivo. */
export interface RoomSettings {
  seed: number | null;
  pace: 'fast' | 'normal';
  numberLayout: string;
  desert: string;
  pointsToWin: number;
  discardLimit: number;
  friendlyRobber: boolean;
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
  players: RoomSeatView[];
  settings: RoomSettings;
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

const JSON_HEADERS = { 'content-type': 'application/json' };

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
  return roomCall('/api/rooms', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) });
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

/** Anfitrião altera regras/mapa/nome/privacidade ao vivo. */
export function updateRoomApi(code: string, patch: Record<string, unknown>): Promise<RoomResult> {
  return roomCall(`/api/rooms/${encodeURIComponent(code)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) });
}

/** Anfitrião adiciona um bot (o servidor escolhe a cor livre). */
export function addBotApi(code: string, opts: { name?: string; difficulty?: BotDifficulty }): Promise<RoomResult> {
  return roomCall(`/api/rooms/${encodeURIComponent(code)}/bots`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ action: 'add', ...opts }),
  });
}

/** Anfitrião remove um bot pela cor. */
export function removeBotApi(code: string, color: string): Promise<RoomResult> {
  return roomCall(`/api/rooms/${encodeURIComponent(code)}/bots`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ action: 'remove', color }),
  });
}

/** Anfitrião muda a dificuldade de um bot. */
export function setBotDifficultyApi(code: string, color: string, difficulty: BotDifficulty): Promise<RoomResult> {
  return roomCall(`/api/rooms/${encodeURIComponent(code)}/bots`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ action: 'difficulty', color, difficulty }),
  });
}

/** Sai da sala de espera (convidado libera a vaga; host encerra a sala). Best-effort. */
export async function leaveRoomApi(code: string): Promise<void> {
  try {
    await fetch(`/api/rooms/${encodeURIComponent(code)}/leave`, { method: 'POST' });
  } catch {
    /* best-effort: se falhar, a limpeza automática cuida da sala */
  }
}

/** URL compartilhável do link único da sala. */
export function roomLink(code: string): string {
  return `${window.location.origin}/room/${code}`;
}
