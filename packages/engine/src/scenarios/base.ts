/**
 * Cenario da familia BASE (jogo classico): tres tamanhos de tabuleiro
 * (standard 19 / large 30 / huge 37 hexes) gerados por "sacos" sorteados sobre a
 * geometria de `buildBoardGeometry`. Esta logica veio de `setup.ts` sem qualquer
 * mudanca de comportamento — a mesma seed reproduz o mesmo tabuleiro de antes.
 */
import { buildBoardGeometry, type BoardLayout } from '../board.js';
import { shuffle } from '../rng.js';
import type { ProgressCard, Resource, RngState, Terrain } from '../types.js';
import { assignNumbers } from './numbers.js';
import type { BuiltScenario, ScenarioOptions, StartingPieces } from './index.js';

/** Distribuicao classica de terrenos para 19 hexes. */
const TERRAIN_BAG: Terrain[] = [
  ...Array<Terrain>(4).fill('forest'),
  ...Array<Terrain>(4).fill('pasture'),
  ...Array<Terrain>(4).fill('field'),
  ...Array<Terrain>(3).fill('hills'),
  ...Array<Terrain>(3).fill('mountain'),
  'desert',
];

/** 18 tokens numericos (sem 7); o deserto nao recebe numero. */
const NUMBER_BAG: number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

/** Tipos de porto: 4 genericos (3:1) + 1 de cada recurso (2:1). */
const PORT_TYPE_BAG: ('generic' | Resource)[] = [
  'generic',
  'generic',
  'generic',
  'generic',
  'wood',
  'brick',
  'wool',
  'grain',
  'ore',
];

/** Baralho de progresso (25 cartas), distribuicao classica. */
const DEV_DECK_BAG: ProgressCard[] = [
  ...Array<ProgressCard>(14).fill('knight'),
  ...Array<ProgressCard>(5).fill('victoryPoint'),
  ...Array<ProgressCard>(2).fill('roadBuilding'),
  ...Array<ProgressCard>(2).fill('yearOfPlenty'),
  ...Array<ProgressCard>(2).fill('monopoly'),
];

const STARTING_PIECES: StartingPieces = { roads: 15, settlements: 5, cities: 4 };

/**
 * Distribuicoes do tabuleiro GRANDE (30 hexes, 5-6 jogadores): 2 desertos, 28
 * tokens numericos, 11 portos, banco 24, baralho de progresso 34.
 */
const LARGE_TERRAIN_BAG: Terrain[] = [
  ...Array<Terrain>(6).fill('forest'),
  ...Array<Terrain>(6).fill('pasture'),
  ...Array<Terrain>(6).fill('field'),
  ...Array<Terrain>(5).fill('hills'),
  ...Array<Terrain>(5).fill('mountain'),
  ...Array<Terrain>(2).fill('desert'),
];

const LARGE_NUMBER_BAG: number[] = [
  2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
];

const LARGE_PORT_TYPE_BAG: ('generic' | Resource)[] = [
  'generic', 'generic', 'generic', 'generic', 'generic', 'generic',
  'wood', 'brick', 'wool', 'grain', 'ore',
];

const LARGE_DEV_DECK_BAG: ProgressCard[] = [
  ...Array<ProgressCard>(20).fill('knight'),
  ...Array<ProgressCard>(6).fill('victoryPoint'),
  ...Array<ProgressCard>(3).fill('roadBuilding'),
  ...Array<ProgressCard>(3).fill('yearOfPlenty'),
  ...Array<ProgressCard>(2).fill('monopoly'),
];

/**
 * Distribuicoes do tabuleiro GIGANTE (37 hexes, 7-8 jogadores): 2 desertos, 35
 * tokens numericos, 13 portos, banco 30, baralho de progresso 45.
 */
const HUGE_TERRAIN_BAG: Terrain[] = [
  ...Array<Terrain>(7).fill('forest'),
  ...Array<Terrain>(7).fill('pasture'),
  ...Array<Terrain>(7).fill('field'),
  ...Array<Terrain>(7).fill('hills'),
  ...Array<Terrain>(7).fill('mountain'),
  ...Array<Terrain>(2).fill('desert'),
];

const HUGE_NUMBER_BAG: number[] = [
  2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12,
];

const HUGE_PORT_TYPE_BAG: ('generic' | Resource)[] = [
  'generic', 'generic', 'generic', 'generic', 'generic', 'generic', 'generic', 'generic',
  'wood', 'brick', 'wool', 'grain', 'ore',
];

const HUGE_DEV_DECK_BAG: ProgressCard[] = [
  ...Array<ProgressCard>(26).fill('knight'),
  ...Array<ProgressCard>(8).fill('victoryPoint'),
  ...Array<ProgressCard>(4).fill('roadBuilding'),
  ...Array<ProgressCard>(4).fill('yearOfPlenty'),
  ...Array<ProgressCard>(3).fill('monopoly'),
];

/** Bags e parametros por tamanho de tabuleiro. */
const LAYOUT_SETUP: Record<BoardLayout, {
  terrain: Terrain[];
  numbers: number[];
  ports: ('generic' | Resource)[];
  devDeck: ProgressCard[];
  bankPerResource: number;
}> = {
  standard: { terrain: TERRAIN_BAG, numbers: NUMBER_BAG, ports: PORT_TYPE_BAG, devDeck: DEV_DECK_BAG, bankPerResource: 19 },
  large: { terrain: LARGE_TERRAIN_BAG, numbers: LARGE_NUMBER_BAG, ports: LARGE_PORT_TYPE_BAG, devDeck: LARGE_DEV_DECK_BAG, bankPerResource: 24 },
  huge: { terrain: HUGE_TERRAIN_BAG, numbers: HUGE_NUMBER_BAG, ports: HUGE_PORT_TYPE_BAG, devDeck: HUGE_DEV_DECK_BAG, bankPerResource: 30 },
};

/**
 * Monta o tabuleiro-base: geometria + terrenos (deserto sorteado ou fixo no
 * centro) + numeros (random/balanced) + tipos de porto. Consome o `rng` na MESMA
 * ordem de antes (terrenos -> numeros -> portos) e o devolve avancado.
 */
export function buildBaseScenario(rng: RngState, opts: ScenarioOptions): BuiltScenario {
  const layout = opts.boardLayout;
  const cfg = LAYOUT_SETUP[layout];
  const board = buildBoardGeometry(layout);
  let cur = rng;

  // 1. Terrenos: o(s) deserto(s) podem ser sorteados ou um fixado no centro.
  let desertHexId: string;
  if (opts.desert === 'center') {
    const center = board.hexOrder.find((h) => board.hexes[h]!.q === 0 && board.hexes[h]!.r === 0)!;
    // Remove UM deserto do saco (fica fixo no centro); os demais seguem sorteados.
    const bag = [...cfg.terrain];
    bag.splice(bag.indexOf('desert'), 1);
    const t = shuffle(cur, bag);
    cur = t.rng;
    let i = 0;
    for (const hid of board.hexOrder) {
      board.hexes[hid]!.terrain = hid === center ? 'desert' : t.value[i++]!;
    }
    desertHexId = center;
  } else {
    const t = shuffle(cur, cfg.terrain);
    cur = t.rng;
    desertHexId = board.hexOrder[0]!;
    board.hexOrder.forEach((hid, i) => {
      board.hexes[hid]!.terrain = t.value[i]!;
      if (t.value[i] === 'desert') desertHexId = hid;
    });
  }
  // Bloqueador comeca em um deserto (o primeiro na ordem dos hexes).
  desertHexId = board.hexOrder.find((h) => board.hexes[h]!.terrain === 'desert') ?? desertHexId;

  // 2. Numeros (so em hexes nao-deserto). 'balanced' garante que nenhum par de
  //    numeros vermelhos (6/8) fique adjacente.
  const nonDesert = board.hexOrder.filter((h) => board.hexes[h]!.terrain !== 'desert');
  for (const hid of board.hexOrder) board.hexes[hid]!.number = null;
  cur = assignNumbers(board, nonDesert, cfg.numbers, cur, opts.numberLayout);

  // 3. Tipos de porto embaralhados (geometria ja veio do grafo).
  const pt = shuffle(cur, cfg.ports);
  cur = pt.rng;
  board.ports.forEach((port, i) => {
    port.type = pt.value[i] ?? 'generic';
  });

  return {
    board,
    expansion: 'base',
    blockerHexId: desertHexId,
    devDeckBag: cfg.devDeck,
    bankPerResource: cfg.bankPerResource,
    startingPieces: STARTING_PIECES,
    rng: cur,
  };
}
