/**
 * Tipos centrais do motor de regras.
 *
 * Termos sao genericos e funcionais (Madeira, Tijolo, La, Trigo, Minerio,
 * Vila, Cidade, Estrada, Bloqueador). A identidade visual/textual final e
 * definida na camada de UI, nao aqui.
 */

export type Resource = 'wood' | 'brick' | 'wool' | 'grain' | 'ore';

export const RESOURCES: readonly Resource[] = ['wood', 'brick', 'wool', 'grain', 'ore'];

export type PlayerColor = 'red' | 'blue' | 'white' | 'orange' | 'green' | 'brown' | 'purple' | 'pink';

/**
 * 4 primeiras = jogo classico (3-4); +green/brown = 5-6; +purple/pink = 7-8.
 */
export const PLAYER_COLORS: readonly PlayerColor[] = ['red', 'blue', 'white', 'orange', 'green', 'brown', 'purple', 'pink'];

/** Tipo de terreno de um hex. 'desert' nao produz e comeca com o bloqueador. */
export type Terrain = 'forest' | 'hills' | 'pasture' | 'field' | 'mountain' | 'desert';

/** Recurso produzido por cada terreno (desert = nenhum). */
export const TERRAIN_RESOURCE: Record<Terrain, Resource | null> = {
  forest: 'wood',
  hills: 'brick',
  pasture: 'wool',
  field: 'grain',
  mountain: 'ore',
  desert: null,
};

export type BuildingKind = 'settlement' | 'city';

export interface Building {
  kind: BuildingKind;
  owner: PlayerColor;
  vertexId: string;
}

export interface Road {
  owner: PlayerColor;
  edgeId: string;
}

/** Cartas de progresso (baralho de "desenvolvimento"). */
export type ProgressCard =
  | 'knight' // Bloqueio: move o bloqueador e rouba; conta para Maior Exercito
  | 'roadBuilding' // 2 estradas gratis
  | 'yearOfPlenty' // +2 recursos do banco
  | 'monopoly' // monopolio de um recurso
  | 'victoryPoint'; // +1 ponto oculto

export interface Player {
  color: PlayerColor;
  name: string;
  hand: Record<Resource, number>;
  /** Cartas de progresso na mao (ocultas dos adversarios na projecao). */
  progressCards: ProgressCard[];
  /** Cartas compradas neste turno (nao podem ser jogadas no mesmo turno). */
  progressCardsBoughtThisTurn: ProgressCard[];
  /** Cavaleiros jogados (Maior Exercito). */
  knightsPlayed: number;
  /** Pecas restantes no estoque do jogador. */
  pieces: { roads: number; settlements: number; cities: number };
  /** Apenas em estados PROJETADOS (fog of war): total de cartas na mao do adversario (composicao oculta). */
  hiddenHand?: number;
  /** Apenas em estados PROJETADOS: quantas cartas de progresso o adversario tem (identidades ocultas). */
  hiddenDevCount?: number;
}

/**
 * Fases do fluxo de jogo.
 *  - setup1 / setup2: colocacao inicial em serpente (vila + estrada).
 *  - roll: jogador da vez precisa rolar os dados.
 *  - main: acoes livres (construir, comerciar, comprar, jogar cartas).
 *  - discard: alguem precisa descartar por causa do 7.
 *  - moveBlocker: jogador da vez precisa mover o bloqueador (apos 7 ou Cavaleiro).
 *  - ended: ha um vencedor.
 */
export type Phase =
  | 'setup1'
  | 'setup2'
  | 'roll'
  | 'main'
  | 'discard'
  | 'moveBlocker'
  | 'ended';

export interface RngState {
  seed: number;
  /** Contador de avancos; o estado do PRNG e derivado de (seed, counter). */
  counter: number;
}

/** Grafo imutavel do tabuleiro (pre-computado uma vez). */
export interface Hex {
  id: string;
  q: number;
  r: number;
  /** Centro em coordenadas de tela (para a UI). */
  cx: number;
  cy: number;
  terrain: Terrain;
  /** Numero do token (2..12, sem 7). null no deserto. */
  number: number | null;
  /** IDs dos 6 vertices (cantos), em ordem. */
  corners: string[];
}

export interface Vertex {
  id: string;
  x: number;
  y: number;
  hexes: string[];
  edges: string[];
  /** Vertices adjacentes (a uma aresta de distancia). */
  adj: string[];
}

export interface Edge {
  id: string;
  /** Os dois vertices que esta aresta conecta. */
  v: [string, string];
  hexes: string[];
}

/** Porto maritimo numa aresta costeira. 'generic' = 3:1; um Resource = 2:1 daquele. */
export interface Port {
  id: string;
  edgeId: string;
  /** Os dois vertices que dao acesso ao porto. */
  vertices: [string, string];
  type: 'generic' | Resource;
  /** Ponto medio da aresta + normal apontando para fora (para a UI). */
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export interface Board {
  hexes: Record<string, Hex>;
  vertices: Record<string, Vertex>;
  edges: Record<string, Edge>;
  ports: Port[];
  /** Ordem estavel para iteracao/renderizacao deterministica. */
  hexOrder: string[];
  vertexOrder: string[];
  edgeOrder: string[];
}

/** Oferta de comercio entre jogadores (uma ativa por vez). */
export interface TradeOffer {
  from: PlayerColor;
  /** O que 'from' oferece (vai para quem aceitar). */
  give: Partial<Record<Resource, number>>;
  /** O que 'from' quer receber. */
  want: Partial<Record<Resource, number>>;
  /** Jogadores elegiveis a responder. */
  to: PlayerColor[];
  /** Quem ja aceitou (o proponente escolhe com quem fechar). */
  accepted: PlayerColor[];
}

export interface GameState {
  phase: Phase;
  players: Player[];
  currentPlayer: PlayerColor;
  /** Indice da rodada de setup (controla a ordem serpente; 0..7 em jogo de 4). */
  setupStep: number;
  /** Durante o setup: vertice da vila recem-colocada que aguarda a estrada. */
  setupLastVertex: string | null;
  /** Trava de "uma carta de progresso por turno". */
  devCardPlayedThisTurn: boolean;
  /** Estradas gratis pendentes (carta "2 estradas"). */
  pendingFreeRoads: number;
  /** Quantas cartas cada jogador ainda precisa descartar (apos um 7). */
  pendingDiscards: Partial<Record<PlayerColor, number>>;
  /** Para onde voltar depois de mover o bloqueador ('roll' se veio de Cavaleiro pre-rolagem). */
  returnPhaseAfterBlocker: 'roll' | 'main' | null;
  /** Oferta de comercio entre jogadores ativa (ou null). */
  activeTrade: TradeOffer | null;
  /** Quantas propostas de troca foram feitas no turno atual (limita bots). */
  tradeOffersThisTurn: number;
  /** Pontos necessarios para vencer (padrao 10). */
  victoryTarget: number;
  /** Acima deste numero de cartas, descarta metade ao rolar 7 (padrao 7). */
  discardLimit: number;
  /** Ladrao amigavel: impede bloquear/roubar quem tem menos de 3 PV publicos. */
  friendlyRobber: boolean;
  board: Board;
  buildings: Record<string, Building>; // por vertexId
  roads: Record<string, Road>; // por edgeId
  bank: Record<Resource, number>;
  devDeck: ProgressCard[];
  /** Apenas em estados PROJETADOS: quantas cartas restam no baralho (ordem oculta). */
  devDeckCount?: number;
  blocker: { hexId: string };
  dice: [number, number] | null;
  /** Bonus de Estrada Mais Longa e Maior Exercito (dono atual ou null). */
  longestRoad: { owner: PlayerColor | null; length: number };
  largestArmy: { owner: PlayerColor | null; size: number };
  winner: PlayerColor | null;
  rng: RngState;
}

export type GameEvent =
  | { t: 'diceRolled'; dice: [number, number]; sum: number }
  | { t: 'produced'; gains: Record<PlayerColor, Partial<Record<Resource, number>>> }
  | { t: 'built'; kind: 'road' | 'settlement' | 'city'; owner: PlayerColor; id: string }
  | { t: 'progressCardBought'; owner: PlayerColor }
  | { t: 'progressCardPlayed'; owner: PlayerColor; card: ProgressCard }
  | { t: 'blockerMoved'; hexId: string; by: PlayerColor; stoleFrom?: PlayerColor; resource?: Resource }
  | { t: 'mustDiscard'; players: { color: PlayerColor; count: number }[] }
  | { t: 'discarded'; owner: PlayerColor }
  | { t: 'bankTrade'; owner: PlayerColor; give: Resource; want: Resource; rate: number }
  | { t: 'cardPlayed'; owner: PlayerColor; card: ProgressCard }
  | { t: 'monopoly'; owner: PlayerColor; resource: Resource; taken: number }
  | { t: 'tradeProposed'; from: PlayerColor }
  | { t: 'tradeCountered'; from: PlayerColor }
  | { t: 'tradeResponded'; player: PlayerColor; accept: boolean }
  | { t: 'tradeExecuted'; from: PlayerColor; with: PlayerColor }
  | { t: 'tradeCancelled' }
  | { t: 'longestRoad'; owner: PlayerColor | null }
  | { t: 'largestArmy'; owner: PlayerColor | null }
  | { t: 'turnEnded'; next: PlayerColor }
  | { t: 'gameWon'; winner: PlayerColor };

export type Action =
  | { t: 'rollDice' }
  | { t: 'placeSettlement'; vertexId: string }
  | { t: 'placeRoad'; edgeId: string }
  | { t: 'buildSettlement'; vertexId: string }
  | { t: 'buildRoad'; edgeId: string }
  | { t: 'buildCity'; vertexId: string }
  | { t: 'buyProgressCard' }
  | { t: 'playKnight' }
  | { t: 'playRoadBuilding' }
  | { t: 'playYearOfPlenty'; resources: [Resource, Resource] }
  | { t: 'playMonopoly'; resource: Resource }
  | { t: 'moveBlocker'; hexId: string; stealFrom?: PlayerColor }
  | { t: 'discard'; resources: Partial<Record<Resource, number>> }
  | { t: 'tradeBank'; give: Resource; want: Resource }
  | { t: 'proposeTrade'; give: Partial<Record<Resource, number>>; want: Partial<Record<Resource, number>>; to?: PlayerColor[] }
  | { t: 'counterTrade'; give: Partial<Record<Resource, number>>; want: Partial<Record<Resource, number>> }
  | { t: 'respondTrade'; accept: boolean }
  | { t: 'confirmTrade'; with: PlayerColor }
  | { t: 'cancelTrade' }
  | { t: 'endTurn' };

export type ReduceResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };
