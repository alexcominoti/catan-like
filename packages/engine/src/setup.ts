import { buildBoardGeometry } from './board.js';
import { createRng, shuffle } from './rng.js';
import {
  PLAYER_COLORS,
  RESOURCES,
  type Board,
  type GameState,
  type Player,
  type PlayerColor,
  type ProgressCard,
  type Resource,
  type RngState,
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

/** Como distribuir os tokens numericos. */
export type NumberLayout = 'random' | 'balanced';
/** Onde fica o deserto (e o bloqueador inicial). */
export type DesertPlacement = 'random' | 'center';

export interface SetupOptions {
  seed: number;
  /** Ate 4 jogadores. Default: 4 cores padrao com nomes genericos. */
  players?: { color?: PlayerColor; name: string }[];
  /** 'balanced' evita que dois numeros vermelhos (6/8) fiquem adjacentes. Default 'random'. */
  numberLayout?: NumberLayout;
  /** 'center' fixa o deserto no hex central. Default 'random'. */
  desert?: DesertPlacement;
}

/**
 * Cria o estado inicial determinístico a partir de uma seed.
 * Mesma seed => mesmo tabuleiro, mesmos numeros, mesmo baralho.
 */
export function createInitialState(opts: SetupOptions): GameState {
  const board = buildBoardGeometry();
  let rng = createRng(opts.seed);

  // 1. Terrenos: o deserto pode ser sorteado ou fixado no centro.
  let desertHexId: string;
  if (opts.desert === 'center') {
    const center = board.hexOrder.find((h) => board.hexes[h]!.q === 0 && board.hexes[h]!.r === 0)!;
    const bag = TERRAIN_BAG.filter((x) => x !== 'desert');
    const t = shuffle(rng, bag);
    rng = t.rng;
    let i = 0;
    for (const hid of board.hexOrder) {
      board.hexes[hid]!.terrain = hid === center ? 'desert' : t.value[i++]!;
    }
    desertHexId = center;
  } else {
    const t = shuffle(rng, TERRAIN_BAG);
    rng = t.rng;
    desertHexId = board.hexOrder[0]!;
    board.hexOrder.forEach((hid, i) => {
      board.hexes[hid]!.terrain = t.value[i]!;
      if (t.value[i] === 'desert') desertHexId = hid;
    });
  }

  // 2. Numeros (so em hexes nao-deserto). 'balanced' garante que nenhum par de
  //    numeros vermelhos (6/8) fique adjacente.
  const nonDesert = board.hexOrder.filter((h) => board.hexes[h]!.terrain !== 'desert');
  for (const hid of board.hexOrder) board.hexes[hid]!.number = null;
  rng = assignNumbers(board, nonDesert, rng, opts.numberLayout ?? 'random');

  // 3. Tipos de porto embaralhados (geometria ja veio do grafo).
  const pt = shuffle(rng, PORT_TYPE_BAG);
  rng = pt.rng;
  board.ports.forEach((port, i) => {
    port.type = pt.value[i] ?? 'generic';
  });

  // 4. Baralho de progresso embaralhado.
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
    returnPhaseAfterBlocker: null,
    activeTrade: null,
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

/** Numeros "vermelhos" (alta probabilidade) que nao devem se tocar no modo balanced. */
const RED_NUMBERS = new Set([6, 8]);

/** Direcoes axiais para vizinhanca de hexes. */
const AXIAL_DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];

/** Mapa hexId -> hexIds vizinhos (compartilham aresta). */
function hexAdjacency(board: Board): Map<string, string[]> {
  const byQR = new Map<string, string>();
  for (const hid of board.hexOrder) {
    const h = board.hexes[hid]!;
    byQR.set(`${h.q},${h.r}`, hid);
  }
  const adj = new Map<string, string[]>();
  for (const hid of board.hexOrder) {
    const h = board.hexes[hid]!;
    const nbs: string[] = [];
    for (const [dq, dr] of AXIAL_DIRS) {
      const nb = byQR.get(`${h.q + dq},${h.r + dr}`);
      if (nb) nbs.push(nb);
    }
    adj.set(hid, nbs);
  }
  return adj;
}

/** Atribui os numeros aos hexes nao-deserto conforme o layout escolhido. */
function assignNumbers(
  board: Board,
  ids: string[],
  rng: RngState,
  layout: NumberLayout,
): RngState {
  if (layout !== 'balanced') {
    const n = shuffle(rng, NUMBER_BAG);
    ids.forEach((hid, i) => (board.hexes[hid]!.number = n.value[i]!));
    return n.rng;
  }

  const adj = hexAdjacency(board);
  let cur = rng;
  for (let attempt = 0; attempt < 500; attempt++) {
    const n = shuffle(cur, NUMBER_BAG);
    cur = n.rng;
    const assign = new Map<string, number>();
    ids.forEach((hid, i) => assign.set(hid, n.value[i]!));
    let ok = true;
    outer: for (const hid of ids) {
      if (!RED_NUMBERS.has(assign.get(hid)!)) continue;
      for (const nb of adj.get(hid) ?? []) {
        const nn = assign.get(nb);
        if (nn !== undefined && RED_NUMBERS.has(nn)) {
          ok = false;
          break outer;
        }
      }
    }
    if (ok) {
      for (const hid of ids) board.hexes[hid]!.number = assign.get(hid)!;
      return cur;
    }
  }
  // Fallback improvavel: aceita o ultimo embaralhamento.
  const n = shuffle(cur, NUMBER_BAG);
  ids.forEach((hid, i) => (board.hexes[hid]!.number = n.value[i]!));
  return n.rng;
}
