/**
 * Cenario de NAVEGADORES (expansao 'sea') — mapa "Novas Terras".
 *
 * Campo hexagonal de raio 3 (37 posicoes). Ao centro, a ILHA PRINCIPAL (island 0)
 * com 9 hexes de terra onde todos comecam; em volta, MAR; e tres ILHAS MENORES
 * (2 hexes cada) espalhadas na borda, alcancaveis so por navio. O deserto fica fixo
 * no centro (inicio do ladrao); ouro e os 5 recursos sao sorteados sobre a terra;
 * numeros balanceados (sem 6/8 adjacentes). Portos ficam em arestas costeiras da
 * ilha principal. O pirata comeca num hex de mar.
 *
 * Colonizar uma ilha menor (a 1a construcao de cada jogador em cada ilha) rende
 * `islandBonus` PV. Peças incluem NAVIOS.
 */
import { buildBoardGraph } from '../board.js';
import { shuffle } from '../rng.js';
import type { Board, Port, ProgressCard, Resource, RngState, Terrain } from '../types.js';
import { assignNumbers } from './numbers.js';
import type { BuiltScenario, ScenarioOptions, StartingPieces } from './index.js';

/** Ilha principal (island 0): 9 hexes de terra ao centro (todos raio <= 2). */
const MAIN_ISLAND: [number, number][] = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1], [2, -1], [-2, 1],
];

/** Ilhas menores (island 1..3): pares de hexes de terra na borda (raio 3). */
const SMALL_ISLANDS: Record<number, [number, number][]> = {
  1: [[0, -3], [1, -3]], // norte
  2: [[3, -2], [3, -1]], // leste
  3: [[-3, 2], [-3, 1]], // sudoeste
};

/** Hex onde o deserto (inicio do ladrao) fica fixo: centro da ilha principal. */
const DESERT_HEX: [number, number] = [0, 0];

/**
 * Saco de terrenos das 14 terras restantes (todas menos o deserto central):
 * 2 ouro + 12 produtores cobrindo os 5 recursos.
 */
const SEA_TERRAIN_BAG: Terrain[] = [
  'gold', 'gold',
  ...Array<Terrain>(3).fill('forest'),
  ...Array<Terrain>(3).fill('field'),
  ...Array<Terrain>(2).fill('pasture'),
  ...Array<Terrain>(2).fill('hills'),
  ...Array<Terrain>(2).fill('mountain'),
];

/** 14 tokens numericos (um 6 e um 8; ouro tambem recebe numero). */
const SEA_NUMBER_BAG: number[] = [2, 3, 3, 4, 4, 5, 5, 6, 8, 9, 9, 10, 11, 12];

/** Tipos de porto nas arestas costeiras da ilha principal (3 genericos + 2 de recurso). */
const SEA_PORT_TYPE_BAG: ('generic' | Resource)[] = ['generic', 'generic', 'generic', 'brick', 'grain'];

const SEA_DEV_DECK_BAG: ProgressCard[] = [
  ...Array<ProgressCard>(14).fill('knight'),
  ...Array<ProgressCard>(5).fill('victoryPoint'),
  ...Array<ProgressCard>(2).fill('roadBuilding'),
  ...Array<ProgressCard>(2).fill('yearOfPlenty'),
  ...Array<ProgressCard>(2).fill('monopoly'),
];

const SEA_STARTING_PIECES: StartingPieces = { roads: 15, settlements: 5, cities: 4, ships: 15 };

/** Coordenadas axiais de um hexagono regular de raio R (37 para R=3). */
function radiusCoords(R: number): { q: number; r: number }[] {
  const coords: { q: number; r: number }[] = [];
  for (let r = -R; r <= R; r++) {
    for (let q = -R; q <= R; q++) {
      if (Math.abs(q) <= R && Math.abs(r) <= R && Math.abs(q + r) <= R) coords.push({ q, r });
    }
  }
  return coords;
}

const keyQR = (q: number, r: number): string => `${q},${r}`;

/** Monta o mapa "Novas Terras" e o estado inicial especifico de Navegadores. */
export function buildSeaScenario(rng: RngState, opts: ScenarioOptions): BuiltScenario {
  const coords = radiusCoords(3);
  const board = buildBoardGraph(coords, 0); // portos definidos pelo cenario (abaixo)

  // Papel de cada hex por coordenada: island 0 (principal), 1..3 (menores), ou mar.
  const islandOf = new Map<string, number>();
  for (const [q, r] of MAIN_ISLAND) islandOf.set(keyQR(q, r), 0);
  for (const [idStr, hexes] of Object.entries(SMALL_ISLANDS)) {
    for (const [q, r] of hexes) islandOf.set(keyQR(q, r), Number(idStr));
  }

  // hexId por coordenada (para localizar deserto/pirata/ilhas).
  const idByQR = new Map<string, string>();
  for (const hid of board.hexOrder) {
    const h = board.hexes[hid]!;
    idByQR.set(keyQR(h.q, h.r), hid);
  }
  const desertHexId = idByQR.get(keyQR(DESERT_HEX[0], DESERT_HEX[1]))!;

  // Marca terra/mar + ilha. Mar = 'sea' (sem numero); terra recebe terreno depois.
  const landHexIds: string[] = [];
  for (const hid of board.hexOrder) {
    const h = board.hexes[hid]!;
    const island = islandOf.get(keyQR(h.q, h.r));
    if (island === undefined) {
      h.terrain = 'sea';
      h.number = null;
    } else {
      h.island = island;
      landHexIds.push(hid);
    }
  }

  let cur = rng;

  // 1. Terrenos: deserto fixo no centro; os demais 14 sorteados sobre a terra.
  board.hexes[desertHexId]!.terrain = 'desert';
  board.hexes[desertHexId]!.number = null;
  const otherLand = landHexIds.filter((h) => h !== desertHexId);
  const t = shuffle(cur, SEA_TERRAIN_BAG);
  cur = t.rng;
  otherLand.forEach((hid, i) => {
    board.hexes[hid]!.terrain = t.value[i]!;
  });

  // 2. Numeros nos hexes produtores (toda a terra menos o deserto; ouro recebe).
  for (const hid of landHexIds) if (board.hexes[hid]!.terrain === 'desert') board.hexes[hid]!.number = null;
  cur = assignNumbers(board, otherLand, SEA_NUMBER_BAG, cur, opts.numberLayout);

  // 3. Portos nas arestas costeiras da ilha principal (posicoes fixas, tipos sorteados).
  const mainHexIds = new Set(landHexIds.filter((h) => board.hexes[h]!.island === 0));
  const pTypes = shuffle(cur, SEA_PORT_TYPE_BAG);
  cur = pTypes.rng;
  board.ports = placeCoastPorts(board, mainHexIds, pTypes.value);

  // Pirata: primeiro hex de mar na ordem (deterministico).
  const pirateHexId = board.hexOrder.find((h) => board.hexes[h]!.terrain === 'sea');

  return {
    board,
    expansion: 'sea',
    blockerHexId: desertHexId,
    pirateHexId,
    devDeckBag: SEA_DEV_DECK_BAG,
    bankPerResource: 19,
    startingPieces: SEA_STARTING_PIECES,
    islandBonus: 2,
    rng: cur,
  };
}

/**
 * Coloca portos nas arestas COSTEIRAS da ilha principal: arestas cujo unico hex de
 * terra vizinho e da ilha principal (o outro lado e mar ou mar aberto). Escolhe
 * `types.length` delas espacadas por angulo em torno do centro e cria os Ports.
 */
function placeCoastPorts(board: Board, mainHexIds: Set<string>, types: ('generic' | Resource)[]): Port[] {
  const coast: string[] = [];
  for (const eid of board.edgeOrder) {
    const e = board.edges[eid]!;
    const landMain = e.hexes.filter((h) => mainHexIds.has(h));
    const anyNonSeaOther = e.hexes.some((h) => !mainHexIds.has(h) && board.hexes[h]!.terrain !== 'sea');
    // Aresta e costa da ilha principal: toca a ilha principal e nao toca OUTRA terra.
    if (landMain.length >= 1 && !anyNonSeaOther) coast.push(eid);
  }

  // Ordena por angulo do ponto medio (em torno do centro 0,0) para espacar.
  const mid = (eid: string): { x: number; y: number } => {
    const e = board.edges[eid]!;
    const a = board.vertices[e.v[0]]!;
    const b = board.vertices[e.v[1]]!;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  coast.sort((p, q) => {
    const mp = mid(p);
    const mq = mid(q);
    return Math.atan2(mp.y, mp.x) - Math.atan2(mq.y, mq.x);
  });

  const ports: Port[] = [];
  const n = Math.min(types.length, coast.length);
  for (let i = 0; i < n; i++) {
    const eid = coast[Math.round((i * coast.length) / n) % coast.length]!;
    const e = board.edges[eid]!;
    const m = mid(eid);
    const len = Math.hypot(m.x, m.y) || 1;
    ports.push({
      id: `p${i}`,
      edgeId: eid,
      vertices: [e.v[0], e.v[1]],
      type: types[i] ?? 'generic',
      x: m.x,
      y: m.y,
      nx: m.x / len,
      ny: m.y / len,
    });
  }
  return ports;
}
