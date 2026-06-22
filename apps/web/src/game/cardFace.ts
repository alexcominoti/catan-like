import type { Resource } from '@hexgame/engine';
import { TERRAIN_FILL } from './theme.js';

/**
 * Faces das cartas de recurso desenhadas em SVG, com a MESMA cor e motivo do
 * hexagono de terreno correspondente (madeira = carta verde com floresta, etc.).
 * Geradas como data URL para entrarem no mesmo pipeline de <img> da mao, modais e
 * animacoes — sem arquivos de imagem.
 */

// Mapa recurso -> terreno (espelha TERRAIN_RESOURCE do engine).
const TERRAIN_OF: Record<Resource, keyof typeof TERRAIN_FILL> = {
  wood: 'forest',
  brick: 'hills',
  wool: 'pasture',
  grain: 'field',
  ore: 'mountain',
};

function tree(x: number, y: number, s: number): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-2.4" y="6" width="4.8" height="11" rx="1" fill="#5b3a1e"/>
    <polygon points="0,-18 12,7 -12,7" fill="#1f6336"/>
    <polygon points="0,-9 11,13 -11,13" fill="#2f8a4e"/>
  </g>`;
}

function sheep(x: number, y: number, s: number): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="0" rx="15" ry="11" fill="#f6f6f1" stroke="#cfcfc6" stroke-width="1.2"/>
    <circle cx="11" cy="-3" r="6" fill="#48433f"/>
    <rect x="5" y="8" width="2.6" height="5" rx="1" fill="#48433f"/>
    <rect x="14" y="8" width="2.6" height="5" rx="1" fill="#48433f"/>
  </g>`;
}

function wheat(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})" stroke="#a8740f" stroke-width="2.4" stroke-linecap="round" fill="none">
    <line x1="0" y1="22" x2="0" y2="-22"/>
    <path d="M0,-16 l-6,-6 M0,-16 l6,-6 M0,-8 l-6,-6 M0,-8 l6,-6 M0,0 l-6,-6 M0,0 l6,-6 M0,8 l-6,-6 M0,8 l6,-6"/>
  </g>`;
}

function brickRow(y: number, offset: number): string {
  let out = '';
  for (let i = -1; i < 3; i++) {
    const x = 18 + i * 24 + offset;
    out += `<rect x="${x}" y="${y}" width="20" height="11" rx="2" fill="#d8763f" stroke="#7c3417" stroke-width="1.4"/>`;
  }
  return out;
}

const MOTIF: Record<Resource, string> = {
  // Floresta: varias arvores.
  wood: `${tree(38, 78, 1.05)}${tree(70, 82, 0.95)}${tree(53, 58, 1.35)}${tree(34, 104, 0.85)}${tree(72, 106, 0.95)}`,
  // Colinas: parede de tijolos.
  brick: `<g>${brickRow(58, 0)}${brickRow(71, 12)}${brickRow(84, 0)}${brickRow(97, 12)}</g>`,
  // Pasto: ovelhas + tufos.
  wool: `${sheep(40, 70, 1.0)}${sheep(64, 92, 0.85)}
    <path d="M26 104 l-3 -8 M30 106 l0 -9 M34 104 l3 -8" stroke="#5f9a2f" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <path d="M74 70 l-3 -8 M78 72 l0 -9 M82 70 l3 -8" stroke="#5f9a2f" stroke-width="2.4" stroke-linecap="round" fill="none"/>`,
  // Campo: espigas de trigo.
  grain: `${wheat(30, 78)}${wheat(53, 72)}${wheat(76, 78)}`,
  // Montanha: picos com neve.
  ore: `<g stroke="#4c545e" stroke-width="1.4" stroke-linejoin="round">
    <polygon points="20,108 48,52 76,108" fill="#6b7480"/>
    <polygon points="52,108 74,66 96,108" fill="#7c8593"/>
    <polygon points="48,52 58,72 38,72" fill="#eef1f4" stroke="none"/>
    <polygon points="74,66 82,82 66,82" fill="#eef1f4" stroke="none"/>
  </g>`,
};

function buildCard(resource: Resource): string {
  const bg = TERRAIN_FILL[TERRAIN_OF[resource]];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 106 150">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
        <stop offset="45%" stop-color="#ffffff" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.18"/>
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="102" height="146" rx="13" fill="#fdfbf6"/>
    <rect x="6" y="6" width="94" height="138" rx="10" fill="${bg}"/>
    ${MOTIF[resource]}
    <rect x="6" y="6" width="94" height="138" rx="10" fill="url(#sky)"/>
    <rect x="6" y="6" width="94" height="138" rx="10" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="1.5"/>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

export const RESOURCE_CARD: Record<Resource, string> = {
  wood: buildCard('wood'),
  brick: buildCard('brick'),
  wool: buildCard('wool'),
  grain: buildCard('grain'),
  ore: buildCard('ore'),
};
