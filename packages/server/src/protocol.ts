import type {
  Action,
  BoardLayout,
  DesertPlacement,
  GameState,
  NumberLayout,
  PlayerColor,
} from '@hexgame/engine';
import type { Difficulty } from '@hexgame/bot';

/** Ritmo da partida (limite de tempo das acoes). */
export type Pace = 'fast' | 'normal';

/** Configuracao de uma sala (espelha o GameConfig do lobby da web). */
export interface RoomConfig {
  seed: number;
  boardLayout: BoardLayout;
  pace: Pace;
  players: { color: PlayerColor; name: string }[];
  bots: PlayerColor[];
  botDifficulty: Record<PlayerColor, Difficulty>;
  numberLayout: NumberLayout;
  desert: DesertPlacement;
  pointsToWin: number;
  discardLimit: number;
  friendlyRobber: boolean;
}

/** Mensagens do CLIENTE para o servidor. */
export type ClientMessage =
  | { t: 'create'; config: RoomConfig; name: string }
  | { t: 'join'; roomId: string; name: string }
  | { t: 'action'; action: Action };

/** Mensagens do SERVIDOR para o cliente. */
export type ServerMessage =
  | { t: 'joined'; roomId: string; color: PlayerColor }
  | { t: 'state'; state: GameState } // estado JA projetado (fog of war) para o destinatario
  | { t: 'error'; error: string };
