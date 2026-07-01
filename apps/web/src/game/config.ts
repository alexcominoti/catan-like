import type { BoardLayout, DesertPlacement, NumberLayout, PlayerColor } from '@trevalis/engine';
import type { Difficulty } from '@trevalis/bot';

/** Ritmo da partida (limite de tempo das ações; aplicado no jogo online). */
export type Pace = 'fast' | 'normal';

export interface GameConfig {
  players: { color: PlayerColor; name: string }[];
  bots: PlayerColor[];
  botDifficulty: Record<PlayerColor, Difficulty>;
  seed: number;
  boardLayout: BoardLayout;
  pace: Pace;
  numberLayout: NumberLayout;
  desert: DesertPlacement;
  pointsToWin: number;
  discardLimit: number;
  friendlyRobber: boolean;
}

/**
 * O que a tela de configuração devolve: igual ao GameConfig, mas a seed pode
 * vir NULL (= aleatória). Quem inicia o jogo local resolve a seed via crypto;
 * salas online deixam o SERVIDOR resolver ao montar o RoomConfig final.
 */
export type GameSetup = Omit<GameConfig, 'seed'> & { seed: number | null };
