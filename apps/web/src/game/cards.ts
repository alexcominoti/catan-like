import type { ProgressCard, Resource } from '@hexgame/engine';
import cardBrick from '../assets/card-brick.jpg';
import cardWood from '../assets/card-wood.jpg';
import cardSheep from '../assets/card-sheep.jpg';
import cardWheat from '../assets/card-wheat.jpg';
import cardOre from '../assets/card-ore.jpg';
import cardKnight from '../assets/card-knight.jpg';
import cardRoad from '../assets/card-road.jpg';
import cardVictory from '../assets/card-victory.jpg';

/** Imagens reais das cartas (compartilhadas entre mao e animacoes). */
export const RES_IMG: Record<Resource, string> = {
  wood: cardWood,
  brick: cardBrick,
  wool: cardSheep,
  grain: cardWheat,
  ore: cardOre,
};

export const DEV_IMG: Record<ProgressCard, string> = {
  knight: cardKnight,
  roadBuilding: cardRoad,
  yearOfPlenty: cardVictory,
  monopoly: cardVictory,
  victoryPoint: cardVictory,
};
