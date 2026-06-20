import type { PlayerColor, Resource, Terrain } from '@hexgame/engine';

/** Cores de terreno (identidade visual propria, nao copia nada comercial). */
export const TERRAIN_FILL: Record<Terrain, string> = {
  forest: '#2f7d45',
  hills: '#b5562f',
  pasture: '#8fc04a',
  field: '#e3b23c',
  mountain: '#8d97a3',
  desert: '#d9c79a',
};

export const TERRAIN_LABEL: Record<Terrain, string> = {
  forest: 'Floresta',
  hills: 'Colinas',
  pasture: 'Pasto',
  field: 'Campo',
  mountain: 'Montanha',
  desert: 'Deserto',
};

export const RESOURCE_LABEL: Record<Resource, string> = {
  wood: 'Madeira',
  brick: 'Tijolo',
  wool: 'Lã',
  grain: 'Trigo',
  ore: 'Minério',
};

export const RESOURCE_ICON: Record<Resource, string> = {
  wood: '🌲',
  brick: '🧱',
  wool: '🐑',
  grain: '🌾',
  ore: '⛰️',
};

export const PLAYER_FILL: Record<PlayerColor, string> = {
  red: '#d64541',
  blue: '#2e6ad1',
  white: '#e8e8e8',
  orange: '#e08a2e',
};

export const PLAYER_LABEL: Record<PlayerColor, string> = {
  red: 'Vermelho',
  blue: 'Azul',
  white: 'Branco',
  orange: 'Laranja',
};
