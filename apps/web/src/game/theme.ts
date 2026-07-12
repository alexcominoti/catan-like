import type { PlayerColor, Resource, Terrain } from '@trevalis/engine';

/** Cores de terreno (identidade visual propria, nao copia nada comercial). */
export const TERRAIN_FILL: Record<Terrain, string> = {
  forest: '#2f7d45',
  hills: '#b5562f',
  pasture: '#8fc04a',
  field: '#e3b23c',
  mountain: '#8d97a3',
  desert: '#d9c79a',
  // Navegadores: mar (agua) e ouro. Ajuste fino do visual na Fase C.
  sea: '#2b6d8f',
  gold: '#e6c34a',
};

// Os rótulos de terreno/recurso/cor agora vivem no dicionário i18n
// (apps/web/src/i18n/messages.*), traduzidos por idioma. Aqui só cores e ícones.

export const RESOURCE_ICON: Record<Resource, string> = {
  wood: '🌲',
  brick: '🧱',
  wool: '🐑',
  grain: '🌾',
  ore: '🪨',
};

export const PLAYER_FILL: Record<PlayerColor, string> = {
  red: '#d64541',
  blue: '#2e6ad1',
  white: '#e8e8e8',
  orange: '#e08a2e',
  green: '#3aa655',
  brown: '#8a5524',
  purple: '#8e44ad',
  pink: '#e0529c',
};
