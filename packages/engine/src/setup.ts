import { buildBoardGeometry } from './board.js';
import { createRng, shuffle } from './rng.js';
import {
  PLAYER_COLORS,
  RESOURCES,
  type GameState,
  type Player,
  type PlayerColor,
  type ProgressCard,
  type Resource,
  type Terrain,
} from './types.js';

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

/** Baralho de progresso (25 cartas), distribuicao classica. */
const DEV_DECK_BAG: ProgressCard[] = [
  ...Array<ProgressCard>(14).fill('knight'),
  ...Array<ProgressCard>(5).fill('victoryPoint'),
  ...Array<ProgressCard>(2).fill('roadBuilding'),
  ...Array<ProgressCard>(2).fill('yearOfPlenty'),
  ...Array<ProgressCard>(2).fill('monopoly'),
];

const STARTING_BANK_PER_RESOURCE = 19;
const STARTING_PIECES = { roads: 15, settlements: 5, cities: 4 } as const;

function emptyHand(): Record<Resource, number> {
  const h = {} as Record<Resource, number>;
  for (const res of RESOURCES) h[res] = 0;
  return h;
}

function makePlayer(color: PlayerColor, name: string): Player {
  return {
    color,
    name,
    hand: emptyHand(),
    progressCards: [],
    progressCardsBoughtThisTurn: [],
    knightsPlayed: 0,
    pieces: { ...STARTING_PIECES },
  };
}

export interface SetupOptions {
  seed: number;
  /** Ate 4 jogadores. Default: 4 cores padrao com nomes genericos. */
  players?: { color?: PlayerColor; name: string }[];
}

/**
 * Cria o estado inicial determinístico a partir de uma seed.
 * Mesma seed => mesmo tabuleiro, mesmos numeros, mesmo baralho.
 */
export function createInitialState(opts: SetupOptions): GameState {
  const board = buildBoardGeometry();
  let rng = createRng(opts.seed);

  // 1. Terrenos embaralhados.
  const t = shuffle(rng, TERRAIN_BAG);
  rng = t.rng;
  const terrains = t.value;

  // 2. Numeros embaralhados (atribuidos so a hexes nao-deserto).
  const n = shuffle(rng, NUMBER_BAG);
  rng = n.rng;
  const numbers = n.value;

  let numIdx = 0;
  let desertHexId = board.hexOrder[0]!;
  board.hexOrder.forEach((hid, i) => {
    const hex = board.hexes[hid]!;
    const terrain = terrains[i]!;
    hex.terrain = terrain;
    if (terrain === 'desert') {
      hex.number = null;
      desertHexId = hid;
    } else {
      hex.number = numbers[numIdx++]!;
    }
  });

  // 3. Baralho de progresso embaralhado.
  const d = shuffle(rng, DEV_DECK_BAG);
  rng = d.rng;
  const devDeck = d.value;

  // 4. Jogadores.
  const playerDefs =
    opts.players && opts.players.length > 0
      ? opts.players
      : PLAYER_COLORS.map((c, i) => ({ color: c, name: `Jogador ${i + 1}` }));
  const players: Player[] = playerDefs.map((p, i) =>
    makePlayer(p.color ?? PLAYER_COLORS[i]!, p.name),
  );

  // 5. Banco.
  const bank = {} as Record<Resource, number>;
  for (const res of RESOURCES) bank[res] = STARTING_BANK_PER_RESOURCE;

  return {
    phase: 'setup1',
    players,
    currentPlayer: players[0]!.color,
    setupStep: 0,
    setupLastVertex: null,
    devCardPlayedThisTurn: false,
    pendingFreeRoads: 0,
    pendingDiscards: {},
    board,
    buildings: {},
    roads: {},
    bank,
    devDeck,
    blocker: { hexId: desertHexId },
    dice: null,
    longestRoad: { owner: null, length: 0 },
    largestArmy: { owner: null, size: 0 },
    winner: null,
    rng,
  };
}
