import type { BoardLayout } from './board.js';
import { createRng, shuffle } from './rng.js';
import { buildScenario } from './scenarios/index.js';
import type { StartingPieces } from './scenarios/index.js';
import {
  PLAYER_COLORS,
  RESOURCES,
  type ExpansionId,
  type GameState,
  type Player,
  type PlayerColor,
  type Resource,
} from './types.js';

function emptyHand(): Record<Resource, number> {
  const h = {} as Record<Resource, number>;
  for (const res of RESOURCES) h[res] = 0;
  return h;
}

function makePlayer(color: PlayerColor, name: string, starting: StartingPieces): Player {
  const pieces: Player['pieces'] = {
    roads: starting.roads,
    settlements: starting.settlements,
    cities: starting.cities,
  };
  // `ships` so entra em Navegadores — mantem o jogo-base com o mesmo shape de antes.
  if (starting.ships !== undefined) pieces.ships = starting.ships;
  return {
    color,
    name,
    hand: emptyHand(),
    progressCards: [],
    progressCardsBoughtThisTurn: [],
    knightsPlayed: 0,
    pieces,
  };
}

/** Como distribuir os tokens numericos. */
export type NumberLayout = 'random' | 'balanced';
/** Onde fica o deserto (e o bloqueador inicial). */
export type DesertPlacement = 'random' | 'center';

export interface SetupOptions {
  seed: number;
  /**
   * Conjunto de regras/mapa. 'base' (default) = jogo classico; 'sea' = Navegadores.
   * O tabuleiro concreto sai do registry de cenarios a partir de (expansion, ...).
   */
  expansion?: ExpansionId;
  /** Id do cenario dentro da expansao (Navegadores tera varios). Opcional. */
  scenario?: string;
  /** Tamanho do tabuleiro: 'standard' (19 hexes, 3-4) ou 'large' (30 hexes, 5-6). Default 'standard'. */
  boardLayout?: BoardLayout;
  /** Ate 4 (standard) ou 6 (large) jogadores. Default: 4 cores padrao com nomes genericos. */
  players?: { color?: PlayerColor; name: string }[];
  /** 'balanced' evita que dois numeros vermelhos (6/8) fiquem adjacentes. Default 'random'. */
  numberLayout?: NumberLayout;
  /** 'center' fixa o deserto no hex central. Default 'random'. */
  desert?: DesertPlacement;
  /** Pontos para vencer (default 10). */
  pointsToWin?: number;
  /** Limite de cartas antes do descarte no 7 (default 7). */
  discardLimit?: number;
  /** Ladrao amigavel: nao bloquear/roubar quem tem <3 PV publicos (default false). */
  friendlyRobber?: boolean;
  /** Dados balanceados: rolagens saem de um saco das 36 combinacoes (default false). */
  balancedDice?: boolean;
}

/** As 36 combinacoes ordenadas de 2d6 (o "saco" dos dados balanceados). */
export function allDiceCombos(): [number, number][] {
  const combos: [number, number][] = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) combos.push([a, b]);
  return combos;
}

/**
 * Cria o estado inicial determinístico a partir de uma seed.
 * Mesma seed => mesmo tabuleiro, mesmos numeros, mesmo baralho.
 *
 * O MAPA (geometria/terrenos/portos/bloqueador/pirata/pecas/banco) vem do registry
 * de cenarios; aqui montamos o que e GENERICO (jogadores, baralho embaralhado, saco
 * de dados) por cima. A ordem de consumo do RNG e preservada: o cenario consome
 * terrenos->numeros->portos, depois embaralhamos o baralho e, por fim, o saco de dados.
 */
export function createInitialState(opts: SetupOptions): GameState {
  const expansion: ExpansionId = opts.expansion ?? 'base';
  let rng = createRng(opts.seed);

  const built = buildScenario(expansion, rng, {
    boardLayout: opts.boardLayout ?? 'standard',
    numberLayout: opts.numberLayout ?? 'random',
    desert: opts.desert ?? 'random',
    scenario: opts.scenario,
  });
  rng = built.rng;
  const board = built.board;

  // Baralho de progresso embaralhado.
  const d = shuffle(rng, built.devDeckBag);
  rng = d.rng;
  const devDeck = d.value;

  // Jogadores (default: 4 cores classicas).
  const playerDefs =
    opts.players && opts.players.length > 0
      ? opts.players
      : PLAYER_COLORS.slice(0, 4).map((c, i) => ({ color: c, name: `Jogador ${i + 1}` }));
  const players: Player[] = playerDefs.map((p, i) =>
    makePlayer(p.color ?? PLAYER_COLORS[i]!, p.name, built.startingPieces),
  );

  // Banco.
  const bank = {} as Record<Resource, number>;
  for (const res of RESOURCES) bank[res] = built.bankPerResource;

  // Dados balanceados (opcional): saco das 36 combinacoes, embaralhado.
  let diceBag: [number, number][] | undefined;
  if (opts.balancedDice) {
    const b = shuffle(rng, allDiceCombos());
    rng = b.rng;
    diceBag = b.value;
  }

  const state: GameState = {
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
    embargoes: [],
    tradeOffersThisTurn: 0,
    victoryTarget: opts.pointsToWin ?? 10,
    discardLimit: opts.discardLimit ?? 7,
    friendlyRobber: opts.friendlyRobber ?? false,
    board,
    buildings: {},
    roads: {},
    bank,
    devDeck,
    blocker: { hexId: built.blockerHexId },
    dice: null,
    balancedDice: opts.balancedDice ?? false,
    diceBag,
    longestRoad: { owner: null, length: 0 },
    largestArmy: { owner: null, size: 0 },
    winner: null,
    rng,
  };

  // Campos especificos de expansao — omitidos no jogo-base para manter o mesmo
  // shape de estado de antes (retrocompat de snapshots/serializacao).
  if (expansion !== 'base') {
    state.expansion = expansion;
    state.ships = {};
    state.pirate = built.pirateHexId ? { hexId: built.pirateHexId } : null;
    if (built.islandBonus !== undefined) state.islandBonus = built.islandBonus;
    for (const p of state.players) p.islandsScored = [];
  }

  return state;
}
