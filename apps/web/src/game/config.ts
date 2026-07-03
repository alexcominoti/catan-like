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
 * O que a tela "Monte sua mesa" devolve ao criar a sala: igual ao GameConfig, mas
 * a seed pode vir NULL (= aleatória). O SERVIDOR resolve a seed ao montar o
 * RoomConfig final da sala (toda partida é online/autoritativa).
 */
export type GameSetup = Omit<GameConfig, 'seed'> & { seed: number | null };
