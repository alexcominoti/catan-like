import type { ProgressCard, Resource } from '@trevalis/engine';
import cardKnight from '../assets/card-knight.jpg';
import cardRoad from '../assets/card-road.jpg';
import cardVictory from '../assets/card-victory.jpg';
import { RESOURCE_CARD } from './cardFace.js';

/**
 * Imagens das cartas (compartilhadas entre mao, modais e animacoes). Os recursos
 * usam faces SVG com a arte do terreno (ver cardFace.ts); as cartas de progresso
 * seguem com as imagens jpg.
 */
export const RES_IMG: Record<Resource, string> = RESOURCE_CARD;

export const DEV_IMG: Record<ProgressCard, string> = {
  knight: cardKnight,
  roadBuilding: cardRoad,
  yearOfPlenty: cardVictory,
  monopoly: cardVictory,
  victoryPoint: cardVictory,
};
