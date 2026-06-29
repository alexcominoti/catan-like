import type { Action, PlayerColor } from '@trevalis/engine';

/**
 * Persistencia simples de partidas (localStorage). Como o engine e deterministico,
 * guardar seed + a sequencia de acoes permite REPRODUZIR a partida inteira. As
 * acoes vem marcadas por quem agiu (e quais cores eram humanas), o que serve de
 * dado de treino para a IA do bot.
 */
export interface SavedReplay {
  id: string;
  date: number;
  seed: number;
  players: { color: PlayerColor; name: string }[];
  humans: PlayerColor[];
  winner: PlayerColor | null;
  pointsToWin: number;
  discardLimit: number;
  boardLayout: string;
  friendlyRobber: boolean;
  numberLayout: string;
  desert: string;
  turns: number;
  durationSec: number;
  actions: { by: PlayerColor; action: Action }[];
}

const KEY = 'trevalis_replays';

export function loadReplays(): SavedReplay[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedReplay[]) : [];
  } catch {
    return [];
  }
}

export function saveReplay(r: SavedReplay): void {
  try {
    const all = loadReplays();
    all.unshift(r);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 30)));
  } catch {
    // sem espaco / indisponivel — ignora.
  }
}

export function deleteReplay(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadReplays().filter((r) => r.id !== id)));
  } catch {
    // ignora
  }
}
