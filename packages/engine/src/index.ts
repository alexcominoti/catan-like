/**
 * @trevalis/engine — motor de regras puro e deterministico.
 *
 * Sem React, sem rede, sem I/O, sem relogio. A mesma seed + a mesma sequencia
 * de acoes reproduzem exatamente a mesma partida (base de testes e replays).
 */

export * from './types.js';
export {
  createInitialState,
  type SetupOptions,
  type NumberLayout,
  type DesertPlacement,
} from './setup.js';
export { reduce } from './reduce.js';
export { projectFor, projectForSpectator } from './project.js';
export {
  COSTS,
  VICTORY_POINTS_TO_WIN,
  LONGEST_ROAD_MIN,
  LARGEST_ARMY_MIN,
  scoreOf,
  publicScoreOf,
  handTotal,
  longestRoadLength,
  maritimeRate,
  computeProduction,
  distanceRuleOk,
  robberAllowed,
  roadConnects,
  vertexTouchesPlayerRoad,
} from './rules.js';
export {
  buildBoardGeometry,
  axialToPixel,
  hexCorners,
  axialCoords,
  HEX_SIZE,
  type BoardLayout,
} from './board.js';
export { createRng, nextInt, nextFloat, rollDie, shuffle } from './rng.js';
