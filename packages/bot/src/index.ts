/**
 * Bot heuristico com 3 niveis (facil / medio / dificil). Puro: sem I/O nem
 * aleatoriedade. `planBotAction` devolve a proxima acao de um bot (jogada do
 * turno, descarte do 7, mover bloqueador, ou aceitar uma troca favoravel).
 *
 * O reducer do engine continua sendo a unica autoridade: o bot so sugere acoes
 * legais; quem aplica e o `reduce`.
 */
import {
  COSTS,
  RESOURCES,
  TERRAIN_RESOURCE,
  computeProduction,
  distanceRuleOk,
  edgeTouchesLand,
  embargoed,
  handTotal,
  islandsAtVertex,
  isSeaEdge,
  isSeaGame,
  longestNetworkLength,
  maritimeRate,
  publicScoreOf,
  reduce,
  robberAllowed,
  robberVictims,
  roadConnects,
  scoreOf,
  shipConnects,
  vertexTouchesMainIsland,
  vertexTouchesPlayerNetwork,
  type Action,
  type GameState,
  type Player,
  type PlayerColor,
  type ProgressCard,
  type Resource,
  type TradeOffer,
} from '@trevalis/engine';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type IsBot = (color: PlayerColor) => boolean;
export type DifficultyOf = (color: PlayerColor) => Difficulty;

export interface BotMove {
  by: PlayerColor;
  action: Action;
}

const DEFAULT_DIFFICULTY: DifficultyOf = () => 'medium';

export function planBotAction(
  state: GameState,
  isBot: IsBot,
  difficultyOf: DifficultyOf = DEFAULT_DIFFICULTY,
): BotMove | null {
  if (state.phase === 'ended') return null;

  // 1. Descartes pendentes de bots (apos um 7).
  if (state.phase === 'discard') {
    const color = botColorsWithDiscard(state, isBot)[0];
    if (color) return { by: color, action: { t: 'discard', resources: chooseDiscard(state, color) } };
    return null; // espera os humanos descartarem
  }

  // 1b. Escolha do OURO pendente de bots (Navegadores).
  if (state.phase === 'chooseGold') {
    const color = (Object.keys(state.pendingGold ?? {}) as PlayerColor[]).find(
      (c) => isBot(c) && (state.pendingGold?.[c] ?? 0) > 0,
    );
    if (color) return { by: color, action: { t: 'chooseGoldResource', resources: chooseGold(state, color) } };
    return null; // espera os humanos escolherem
  }

  // 2. Respostas de troca: o bot SO aceita (uma vez) quando favoravel.
  if (state.activeTrade) {
    const t = state.activeTrade;
    for (const c of t.to) {
      // Ofertas com coringa (wantAny) exigem que quem aceita escolha os recursos —
      // o bot não resolve isso; simplesmente ignora essas ofertas.
      if (isBot(c) && !t.accepted.includes(c) && !t.wantAny && tradeFavorable(state, c, t, difficultyOf(c))) {
        return { by: c, action: { t: 'respondTrade', accept: true } };
      }
    }
    // Durante QUALQUER troca ativa na vez do bot (oferta propria ou uma
    // contraproposta de humano), ele aguarda — a UI resolve via resolveBotProposal.
    if (isBot(state.currentPlayer)) return null;
  }

  const me = state.currentPlayer;
  if (!isBot(me)) return null;
  const level = difficultyOf(me);
  const humans = state.players.filter((p) => !isBot(p.color)).map((p) => p.color);

  switch (state.phase) {
    case 'moveBlocker':
      return { by: me, action: planBlocker(state, me, level) };
    case 'setup1':
    case 'setup2':
      if (state.setupLastVertex) return { by: me, action: { t: 'placeRoad', edgeId: bestSetupRoad(state, me) } };
      return {
        by: me,
        action: {
          t: 'placeSettlement',
          vertexId: level === 'hard' ? bestSetupVertexByValue(state, me) : bestSetupVertex(state, level),
        },
      };
    case 'roll': {
      const knight = maybeKnight(state, me);
      return { by: me, action: knight ?? { t: 'rollDice' } };
    }
    case 'main':
      return {
        by: me,
        action: level === 'hard' ? planMainByValue(state, me, humans) : planMain(state, me, level, humans),
      };
    default:
      return null;
  }
}

/**
 * Resolve a proposta de troca do bot apos a janela de resposta: fecha com o
 * primeiro que aceitou, ou cancela. A UI chama isto quando o tempo acaba.
 */
export function resolveBotProposal(state: GameState): BotMove | null {
  const t = state.activeTrade;
  if (!t) return null;
  if (t.accepted.length > 0) return { by: t.from, action: { t: 'confirmTrade', with: t.accepted[0]! } };
  return { by: t.from, action: { t: 'cancelTrade' } };
}

/**
 * Sugere o melhor vertice para a vila inicial (mesma avaliacao do nivel dificil).
 * Usado pela UI para destacar um bom spot ao humano durante o setup.
 */
export function suggestSetupSettlement(state: GameState, color: PlayerColor): string {
  return bestSetupVertexByValue(state, color);
}

// ---------------------------------------------------------------------------
// Avaliacao de posicoes (sensivel ao nivel)
// ---------------------------------------------------------------------------

function pip(n: number | null): number {
  return n === null ? 0 : 6 - Math.abs(7 - n);
}

const SCARCE: Partial<Record<Resource, number>> = { ore: 0.5, brick: 0.4 };

function vertexValue(state: GameState, vid: string, level: Difficulty): number {
  const v = state.board.vertices[vid];
  if (!v) return 0;
  let sum = 0;
  const res = new Set<Resource>();
  for (const hid of v.hexes) {
    const hex = state.board.hexes[hid]!;
    sum += pip(hex.number);
    const r = TERRAIN_RESOURCE[hex.terrain];
    if (r) {
      res.add(r);
      if (level === 'hard') sum += (SCARCE[r] ?? 0) * pip(hex.number) * 0.2;
    }
  }
  if (level === 'easy') return sum; // ignora variedade e portos
  let value = sum + res.size * 0.6;
  if (level === 'hard') {
    const onPort = state.board.ports.some((p) => p.vertices.includes(vid));
    if (onPort) value += 1.2;
  }
  return value;
}

function getPlayer(state: GameState, color: PlayerColor): Player {
  return state.players.find((p) => p.color === color)!;
}

function canAfford(hand: Record<Resource, number>, cost: Partial<Record<Resource, number>>): boolean {
  return (Object.entries(cost) as [Resource, number][]).every(([r, n]) => hand[r] >= n);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Vertice valido para a colocacao inicial (Navegadores: so na ilha principal). */
function setupValid(state: GameState, vid: string): boolean {
  if (!distanceRuleOk(state, vid)) return false;
  return !isSeaGame(state) || vertexTouchesMainIsland(state, vid);
}

function bestSetupVertex(state: GameState, level: Difficulty): string {
  const valid = state.board.vertexOrder.filter((vid) => setupValid(state, vid));
  if (valid.length === 0) return state.board.vertexOrder[0]!;
  const scored = valid.map((vid) => ({ vid, s: vertexValue(state, vid, level) })).sort((a, b) => b.s - a.s);
  // Facil escolhe um vertice mediano (jogo mais fraco); os demais, o melhor.
  if (level === 'easy') return scored[Math.floor(scored.length / 2)]!.vid;
  return scored[0]!.vid;
}

function bestSetupRoad(state: GameState, _me: PlayerColor): string {
  const last = state.setupLastVertex!;
  const v = state.board.vertices[last]!;
  // Navegadores: a estrada inicial fica em terra (nunca no mar).
  const landOk = (e: string): boolean => !isSeaGame(state) || edgeTouchesLand(state, e);
  let best = v.edges.find((e) => !state.roads[e] && landOk(e)) ?? v.edges.find((e) => !state.roads[e]) ?? v.edges[0]!;
  let bestScore = -1;
  for (const eid of v.edges) {
    if (state.roads[eid] || !landOk(eid)) continue;
    const e = state.board.edges[eid]!;
    const other = e.v[0] === last ? e.v[1] : e.v[0];
    const s = vertexValue(state, other, 'medium');
    if (s > bestScore) {
      bestScore = s;
      best = eid;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fase principal
// ---------------------------------------------------------------------------

function planMain(state: GameState, me: PlayerColor, level: Difficulty, humans: PlayerColor[]): Action {
  const p = getPlayer(state, me);

  // 1. Jogar uma carta util (uma por turno).
  const card = planPlayCard(state, me, level);
  if (card) return card;

  // 2. Estrada/navio gratis pendente (carta "2 Estradas"; navio conta em Navegadores).
  if (state.pendingFreeRoads > 0) {
    const road = p.pieces.roads > 0 ? (roadToUnlock(state, me, level) ?? bestRoadTowardLand(state, me, level)) : null;
    if (road) return { t: 'buildRoad', edgeId: road };
    const ship = shipToUnlock(state, me, level) ?? bestShipTowardLand(state, me, level);
    if (ship) return { t: 'buildShip', edgeId: ship };
    const any = p.pieces.roads > 0 ? anyLegalRoad(state, me) : null;
    if (any) return { t: 'buildRoad', edgeId: any };
  }

  // 3. Cidade (2 PV).
  const city = bestCityTarget(state, me, level);
  if (city && p.pieces.cities > 0 && canAfford(p.hand, COSTS.city)) {
    return { t: 'buildCity', vertexId: city };
  }

  // 4. Vila (expansao = mais producao e PV).
  const settle = bestSettlementTarget(state, me, level);
  if (settle && p.pieces.settlements > 0 && canAfford(p.hand, COSTS.settlement)) {
    return { t: 'buildSettlement', vertexId: settle };
  }

  // 5. Estrada que destrava uma nova vila.
  if (p.pieces.roads > 0 && p.pieces.settlements > 0 && canAfford(p.hand, COSTS.road)) {
    const road = roadToUnlock(state, me, level);
    if (road) return { t: 'buildRoad', edgeId: road };
  }

  // 5b. Navio que destrava uma nova vila (Navegadores: rumo as ilhas).
  if ((p.pieces.ships ?? 0) > 0 && p.pieces.settlements > 0 && canAfford(p.hand, COSTS.ship)) {
    const ship = shipToUnlock(state, me, level);
    if (ship) return { t: 'buildShip', edgeId: ship };
  }

  // 6. Oferecer uma troca a um humano (uma por turno) rumo a expansao.
  const offer = planTradeProposal(state, me, level, humans);
  if (offer) return offer;

  // 7. Trocar com o banco rumo a EXPANSAO (cidade > vila > estrada). Cartas nao.
  const trade = tradeTowardGoal(state, me, level);
  if (trade) return trade;

  // 8. Sem como expandir agora: usar a sobra comprando carta (PV/cavaleiro).
  if (state.devDeck.length > 0 && canAfford(p.hand, COSTS.progressCard)) {
    return { t: 'buyProgressCard' };
  }

  // 9. Estender estrada (caca a Maior Rota) — mantem o jogo avancando.
  if (p.pieces.roads > 0 && canAfford(p.hand, COSTS.road)) {
    const road = roadToUnlock(state, me, level) ?? bestRoadTowardLand(state, me, level) ?? anyLegalRoad(state, me);
    if (road) return { t: 'buildRoad', edgeId: road };
  }

  // 9b. Estender navio (Navegadores: rumo as ilhas / Maior Rota).
  if ((p.pieces.ships ?? 0) > 0 && canAfford(p.hand, COSTS.ship)) {
    const ship = shipToUnlock(state, me, level) ?? bestShipTowardLand(state, me, level);
    if (ship) return { t: 'buildShip', edgeId: ship };
  }

  return { t: 'endTurn' };
}

/** Metas de expansao do bot (sem cartas): cidade > vila > estrada que destrava. */
function expansionGoals(state: GameState, me: PlayerColor, level: Difficulty): Partial<Record<Resource, number>>[] {
  const p = getPlayer(state, me);
  const goals: Partial<Record<Resource, number>>[] = [];
  if (bestCityTarget(state, me, level) && p.pieces.cities > 0) goals.push(COSTS.city);
  if (bestSettlementTarget(state, me, level) && p.pieces.settlements > 0) goals.push(COSTS.settlement);
  if (roadToUnlock(state, me, level) && p.pieces.roads > 0 && p.pieces.settlements > 0) goals.push(COSTS.road);
  // Navegadores: um navio que destrava ilha tambem e meta (custo madeira+la).
  if ((p.pieces.ships ?? 0) > 0 && shipToUnlock(state, me, level)) goals.push(COSTS.ship);
  return goals;
}

/**
 * Oferta de troca 1:1 a um humano: da 1 de um excedente (cuja taxa de banco seria
 * >=3) por 1 do recurso que falta para a expansao. So uma oferta por turno.
 */
function planTradeProposal(
  state: GameState,
  me: PlayerColor,
  level: Difficulty,
  humans: PlayerColor[],
): Action | null {
  // Nunca oferece a quem está em embargo (senão o reduce recusaria e o bot travaria).
  const targets = humans.filter((h) => !embargoed(state, me, h));
  if (targets.length === 0 || state.tradeOffersThisTurn > 0) return null;
  const p = getPlayer(state, me);
  for (const cost of expansionGoals(state, me, level)) {
    const needed = RESOURCES.find((r) => (cost[r] ?? 0) - p.hand[r] > 0);
    if (!needed) continue;
    const give = RESOURCES.find(
      (r) => r !== needed && p.hand[r] - (cost[r] ?? 0) >= 1 && maritimeRate(state, me, r) >= 3,
    );
    if (!give) continue;
    return { t: 'proposeTrade', give: { [give]: 1 }, want: { [needed]: 1 }, to: targets };
  }
  return null;
}

function bestCityTarget(state: GameState, me: PlayerColor, level: Difficulty): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const [vid, b] of Object.entries(state.buildings)) {
    if (b.owner !== me || b.kind !== 'settlement') continue;
    const s = vertexValue(state, vid, level);
    if (s > bestScore) {
      bestScore = s;
      best = vid;
    }
  }
  return best;
}

function bestSettlementTarget(state: GameState, me: PlayerColor, level: Difficulty): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const vid of state.board.vertexOrder) {
    if (!distanceRuleOk(state, vid)) continue;
    if (!vertexTouchesPlayerNetwork(state, me, vid)) continue;
    // Navegadores: colonizar ilha nova vale mais (VP de ilha).
    const islandBonus = state.islandBonus && islandsAtVertex(state, vid).length > 0 ? 2.5 : 0;
    const s = vertexValue(state, vid, level) + islandBonus;
    if (s > bestScore) {
      bestScore = s;
      best = vid;
    }
  }
  return best;
}

/** Uma aresta pode receber ESTRADA do jogador (livre, toca terra, conecta). */
function roadPlaceable(state: GameState, me: PlayerColor, eid: string): boolean {
  if (state.roads[eid] || state.ships?.[eid]) return false;
  if (!edgeTouchesLand(state, eid)) return false; // no mar, so navio
  return roadConnects(state, me, eid);
}

function roadToUnlock(state: GameState, me: PlayerColor, level: Difficulty): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const eid of state.board.edgeOrder) {
    if (!roadPlaceable(state, me, eid)) continue;
    const e = state.board.edges[eid]!;
    for (const far of e.v) {
      if (state.buildings[far]) continue;
      if (!distanceRuleOk(state, far)) continue;
      if (vertexTouchesPlayerNetwork(state, me, far)) continue;
      const s = vertexValue(state, far, level);
      if (s > bestScore) {
        bestScore = s;
        best = eid;
      }
    }
  }
  return best;
}

function anyLegalRoad(state: GameState, me: PlayerColor): string | null {
  for (const eid of state.board.edgeOrder) {
    if (roadPlaceable(state, me, eid)) return eid;
  }
  return null;
}

/**
 * Melhor estrada para ESTENDER a rede rumo a boa terra (nao destrava uma vila em 1
 * passo, mas aponta para o vertice livre de maior valor — evita "estrada para o
 * nada"). Usada como fallback quando nao ha unlock imediato.
 */
function bestRoadTowardLand(state: GameState, me: PlayerColor, level: Difficulty): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const eid of state.board.edgeOrder) {
    if (!roadPlaceable(state, me, eid)) continue;
    const e = state.board.edges[eid]!;
    let s = -1;
    for (const v of e.v) {
      if (state.buildings[v]) continue; // extremo ocupado nao e fronteira util
      s = Math.max(s, vertexValue(state, v, level));
    }
    if (s > bestScore) {
      bestScore = s;
      best = eid;
    }
  }
  return best;
}

/** Uma aresta de mar onde o bot PODE pôr navio (conectada, livre, longe do pirata). */
function shipPlaceable(state: GameState, me: PlayerColor, eid: string): boolean {
  if (state.roads[eid] || state.ships?.[eid]) return false;
  if (!isSeaEdge(state, eid) || !shipConnects(state, me, eid)) return false;
  if (state.pirate && state.board.edges[eid]!.hexes.includes(state.pirate.hexId)) return false;
  return true;
}

/**
 * Navegadores: navio que DESTRAVA uma nova vila (abre um vertice livre e legal —
 * priorizando ilhas novas). Espelha `roadToUnlock`, mas no mar.
 */
function shipToUnlock(state: GameState, me: PlayerColor, level: Difficulty): string | null {
  if (!isSeaGame(state) || (getPlayer(state, me).pieces.ships ?? 0) <= 0) return null;
  let best: string | null = null;
  let bestScore = -1;
  for (const eid of state.board.edgeOrder) {
    if (!shipPlaceable(state, me, eid)) continue;
    for (const far of state.board.edges[eid]!.v) {
      if (state.buildings[far] || !distanceRuleOk(state, far)) continue;
      if (vertexTouchesPlayerNetwork(state, me, far)) continue;
      const s = vertexValue(state, far, level) + (islandsAtVertex(state, far).length > 0 ? 3 : 0);
      if (s > bestScore) { bestScore = s; best = eid; }
    }
  }
  return best;
}

/** Navio que ESTENDE a rede rumo a boa terra/ilha (fallback quando nao ha unlock). */
function bestShipTowardLand(state: GameState, me: PlayerColor, level: Difficulty): string | null {
  if (!isSeaGame(state) || (getPlayer(state, me).pieces.ships ?? 0) <= 0) return null;
  let best: string | null = null;
  let bestScore = -1;
  for (const eid of state.board.edgeOrder) {
    if (!shipPlaceable(state, me, eid)) continue;
    let s = -1;
    for (const v of state.board.edges[eid]!.v) {
      if (state.buildings[v]) continue;
      s = Math.max(s, vertexValue(state, v, level) + (islandsAtVertex(state, v).length > 0 ? 2 : 0));
    }
    if (s > bestScore) { bestScore = s; best = eid; }
  }
  return best;
}

function tradeTowardGoal(state: GameState, me: PlayerColor, level: Difficulty): Action | null {
  const p = getPlayer(state, me);
  for (const cost of expansionGoals(state, me, level)) {
    let want: Resource | null = null;
    for (const r of RESOURCES) {
      if ((cost[r] ?? 0) - p.hand[r] > 0 && state.bank[r] > 0) {
        want = r;
        break;
      }
    }
    if (!want) continue;
    for (const give of RESOURCES) {
      if (give === want) continue;
      const rate = maritimeRate(state, me, give);
      const spare = p.hand[give] - (cost[give] ?? 0);
      if (spare >= rate) return { t: 'tradeBank', give, want };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Nivel "dificil": funcao de valor + escolha por simulacao (ValueFunctionPlayer)
//
// Inspirado no catanatron (https://github.com/bcollazo/catanatron): em Catan, a
// busca Alpha-Beta/expectimax com uma funcao de valor feita a mao supera ML
// (RL/MCTS decepcionaram). Aqui fazemos a versao 1-ply: enumerar as construcoes
// legais, aplicar o `reduce` puro do engine e escolher a que maximiza a funcao
// de valor do estado resultante. Ver passos 3-4 (busca de profundidade 2 e
// auto-ajuste de pesos por self-play) no bloco FUTURE FEATURES no fim do arquivo.
// ---------------------------------------------------------------------------

/** Pesos da funcao de valor (em "pips equivalentes"). Ajustaveis por self-play. */
const W = {
  vp: 4.0, // por ponto de vitoria (publico + cartas +1PV proprias)
  production: 1.0, // por pip de producao propria efetiva
  variety: 0.8, // por recurso distinto que produzo
  enemyProduction: -0.4, // por pip de producao do adversario mais forte
  buildablePips: 0.7, // por pip de um no vazio JA construivel (oportunidade imediata)
  buildableCount: 0.4, // por no construivel (variedade de opcoes de expansao)
  reachable1Pips: 0.25, // por pip de um no alcancavel com +1 estrada
  handSynergy: 0.3, // proximidade da mao de comprar cidade/vila (negativo => perto e melhor)
  handCards: 0.04, // liquidez
  overflow: -0.7, // por carta acima de 7 (risco de descarte no 7)
  longestRoadLen: 0.3, // por segmento da minha maior estrada (caca ao titulo)
  knights: 0.3, // por cavaleiro jogado (caca ao Maior Exercito)
  devCards: 0.25, // por carta de desenvolvimento na mao
};

/** Producao efetiva de um jogador: soma de pips (cidade conta dobrado) + variedade. */
function production(state: GameState, color: PlayerColor): { pips: number; variety: number } {
  let pips = 0;
  const res = new Set<Resource>();
  for (const b of Object.values(state.buildings)) {
    if (b.owner !== color) continue;
    const v = state.board.vertices[b.vertexId];
    if (!v) continue;
    const mult = b.kind === 'city' ? 2 : 1;
    for (const hid of v.hexes) {
      const hex = state.board.hexes[hid]!;
      const r = TERRAIN_RESOURCE[hex.terrain];
      if (!r) continue;
      pips += pip(hex.number) * mult;
      res.add(r);
    }
  }
  return { pips, variety: res.size };
}

/** Potencial de producao (pips) de um vertice vazio, para avaliar expansao. */
function vertexPips(state: GameState, vid: string): number {
  const v = state.board.vertices[vid];
  if (!v) return 0;
  let sum = 0;
  for (const hid of v.hexes) sum += pip(state.board.hexes[hid]!.number);
  return sum;
}

/**
 * Espaco de expansao: nos vazios JA construiveis (ponderados por pips, +contagem)
 * e producao alcancavel com +1 estrada. Ponderar por pips faz a estrada que abre
 * um otimo vertice valer a pena (catanatron pesa muito os `buildable_nodes`).
 */
function expansionReach(state: GameState, me: PlayerColor): { buildablePips: number; buildableCount: number; reachable1Pips: number } {
  let buildablePips = 0;
  let buildableCount = 0;
  let reachable1Pips = 0;
  for (const vid of state.board.vertexOrder) {
    if (state.buildings[vid] || !distanceRuleOk(state, vid)) continue;
    if (vertexTouchesPlayerNetwork(state, me, vid)) {
      buildablePips += vertexPips(state, vid);
      buildableCount += 1;
      continue;
    }
    const v = state.board.vertices[vid]!;
    if (v.edges.some((eid) => !state.roads[eid] && roadConnects(state, me, eid))) {
      reachable1Pips += vertexPips(state, vid);
    }
  }
  return { buildablePips, buildableCount, reachable1Pips };
}

/** Quao longe a mao esta de comprar cidade/vila (0 = pronto; maior = mais longe). */
function handDistance(hand: Record<Resource, number>): number {
  const city = Math.max(2 - hand.grain, 0) + Math.max(3 - hand.ore, 0);
  const settle =
    Math.max(1 - hand.grain, 0) +
    Math.max(1 - hand.wool, 0) +
    Math.max(1 - hand.brick, 0) +
    Math.max(1 - hand.wood, 0);
  return city + settle;
}

/**
 * Funcao de valor: avalia a posicao de `me`. Combina producao (e a do adversario
 * mais forte, negativa), expansao, pontos, sinergia da mao e cacas a titulos.
 */
function evaluate(state: GameState, me: PlayerColor): number {
  const mine = production(state, me);
  let enemyPips = 0;
  for (const p of state.players) {
    if (p.color === me) continue;
    enemyPips = Math.max(enemyPips, production(state, p.color).pips);
  }
  const { buildablePips, buildableCount, reachable1Pips } = expansionReach(state, me);
  const p = getPlayer(state, me);
  const cards = handTotal(p);
  return (
    W.vp * scoreOf(state, me) +
    W.production * mine.pips +
    W.variety * mine.variety +
    W.enemyProduction * enemyPips +
    W.buildablePips * buildablePips +
    W.buildableCount * buildableCount +
    W.reachable1Pips * reachable1Pips +
    W.handSynergy * -handDistance(p.hand) +
    W.handCards * cards +
    W.overflow * Math.max(0, cards - 7) +
    W.longestRoadLen * longestNetworkLength(state, me) +
    W.knights * p.knightsPlayed +
    W.devCards * p.progressCards.length
  );
}

// ---------------------------------------------------------------------------
// Passo 3 — no de ACASO (dados): expectimax de profundidade 2.
//
// O AlphaBetaPlayer(n=2) do catanatron deve boa parte da forca a MODELAR a
// incerteza do dado: avalia a posicao pelo valor ESPERADO sobre a proxima
// rolagem, nao pelo estado estatico. Aqui fazemos exatamente isso como folha do
// nivel dificil: para cada acao candidata, em vez de `evaluate(resultado)` usamos
// `expectedValue(resultado)` = media de `evaluate` sobre as somas 2..12 ponderadas
// pela probabilidade. Assim o bot prefere posicoes cujos numeros tem mais chance
// de sair, valoriza construir em 6/8 e penaliza o risco do 7 (descarte).
// ---------------------------------------------------------------------------

/** Distribuicao da soma de 2d6 (contagens sobre 36) — o no de acaso. */
const DICE_WEIGHTS: Readonly<Record<number, number>> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

function totalOf(hand: Record<Resource, number>): number {
  let s = 0;
  for (const r of RESOURCES) s += hand[r];
  return s;
}

/** Descarta as `n` cartas mais abundantes de `hand` (aproxima o descarte do 7). */
function discardMost(hand: Record<Resource, number>, n: number): void {
  for (let i = 0; i < n; i++) {
    let best: Resource = RESOURCES[0]!;
    for (const r of RESOURCES) if (hand[r] > hand[best]) best = r;
    if (hand[best] <= 0) break;
    hand[best] -= 1;
  }
}

/**
 * Valor ESPERADO da posicao apos a proxima rolagem (expectimax prof. 2). Uma
 * rolagem so muda a MINHA mao — o tabuleiro, a producao potencial, os PV e o
 * espaco de expansao nao mudam —, entao o valor esperado e o valor estatico
 * `evaluate` mais a media da variacao dos termos de mao (liquidez, sinergia,
 * overflow). Isso e exatamente `E[evaluate(estado_pos_rolagem)]`, porem barato
 * (sem clonar o estado). No 7 nao ha producao e modelo o risco de EU descartar
 * metade se estourar o limite; os demais efeitos do 7 (ladrao) sao imprevisiveis.
 */
function expectedValue(state: GameState, me: PlayerColor): number {
  const base = evaluate(state, me);
  const p = getPlayer(state, me);
  const oldTotal = totalOf(p.hand);
  const oldDist = handDistance(p.hand);
  const oldOver = Math.max(0, oldTotal - 7);
  let acc = 0;
  for (let sum = 2; sum <= 12; sum++) {
    const w = DICE_WEIGHTS[sum]!;
    const hand = { ...p.hand };
    if (sum === 7) {
      if (oldTotal > state.discardLimit) discardMost(hand, Math.floor(oldTotal / 2));
    } else {
      const gains = computeProduction(state, sum)[me] ?? {};
      for (const r of RESOURCES) hand[r] += gains[r] ?? 0;
    }
    const nTotal = totalOf(hand);
    acc +=
      w *
      (W.handCards * (nTotal - oldTotal) +
        W.handSynergy * -(handDistance(hand) - oldDist) +
        W.overflow * (Math.max(0, nTotal - 7) - oldOver));
  }
  return base + acc / 36;
}

/** Vertice de setup que maximiza o valor ESPERADO sobre a proxima rolagem. */
function bestSetupVertexByValue(state: GameState, me: PlayerColor): string {
  const valid = state.board.vertexOrder.filter((vid) => setupValid(state, vid));
  if (valid.length === 0) return state.board.vertexOrder[0]!;
  let best = valid[0]!;
  let bestV = -Infinity;
  for (const vid of valid) {
    const r = reduce(state, me, { t: 'placeSettlement', vertexId: vid });
    if (!r.ok) continue;
    const v = expectedValue(r.state, me);
    if (v > bestV) {
      bestV = v;
      best = vid;
    }
  }
  return best;
}

/** Dentre as acoes candidatas, a que maximiza a funcao de valor (simulando cada uma). */
function bestActionByValue(state: GameState, me: PlayerColor, candidates: Action[]): Action | null {
  let best: Action | null = null;
  let bestV = -Infinity;
  for (const a of candidates) {
    const r = reduce(state, me, a);
    if (!r.ok) continue;
    const v = expectedValue(r.state, me);
    if (v > bestV) {
      bestV = v;
      best = a;
    }
  }
  return best;
}

/**
 * Fase principal do nivel dificil (HIBRIDO). Mantem a MESMA ordem de prioridades
 * do nivel medio — que ja expande e fecha jogos com eficiencia (cidade > vila >
 * estrada que destrava > troca > carta) — mas escolhe ONDE construir pela funcao
 * de valor (simula cada alvo e pega o de maior valor de TABULEIRO, ciente da
 * producao do adversario e do espaco de expansao), em vez do pip local.
 *
 * Por que hibrido e nao 1-ply puro: medimos por self-play que o ValueFunctionPlayer
 * guloso de 1 lance NAO supera esta lista de prioridades (a forca do catanatron vem
 * da busca de profundidade 2 — passo 3). O hibrido nunca regride abaixo do medio e
 * decide as colocacoes melhor.
 */
function planMainByValue(state: GameState, me: PlayerColor, humans: PlayerColor[]): Action {
  const p = getPlayer(state, me);

  // 1. Carta util (heuristica ja boa; evita "espiar" o baralho ao simular compra).
  const card = planPlayCard(state, me, 'hard');
  if (card) return card;

  // 2. Estrada/navio gratis pendente (carta "2 Estradas").
  if (state.pendingFreeRoads > 0) {
    const road = p.pieces.roads > 0 ? (roadToUnlock(state, me, 'hard') ?? bestRoadTowardLand(state, me, 'hard')) : null;
    if (road) return { t: 'buildRoad', edgeId: road };
    const ship = shipToUnlock(state, me, 'hard') ?? bestShipTowardLand(state, me, 'hard');
    if (ship) return { t: 'buildShip', edgeId: ship };
    const any = p.pieces.roads > 0 ? anyLegalRoad(state, me) : null;
    if (any) return { t: 'buildRoad', edgeId: any };
  }

  // 3. Cidade (2 PV): escolhe QUAL vila promover pela funcao de valor.
  if (p.pieces.cities > 0 && canAfford(p.hand, COSTS.city)) {
    const cands: Action[] = [];
    for (const [vid, b] of Object.entries(state.buildings)) {
      if (b.owner === me && b.kind === 'settlement') cands.push({ t: 'buildCity', vertexId: vid });
    }
    const a = bestActionByValue(state, me, cands);
    if (a) return a;
  }

  // 4. Vila (expansao): escolhe O MELHOR vertice pela funcao de valor.
  if (p.pieces.settlements > 0 && canAfford(p.hand, COSTS.settlement)) {
    const cands: Action[] = [];
    for (const vid of state.board.vertexOrder) {
      if (!state.buildings[vid] && distanceRuleOk(state, vid) && vertexTouchesPlayerNetwork(state, me, vid)) {
        cands.push({ t: 'buildSettlement', vertexId: vid });
      }
    }
    const a = bestActionByValue(state, me, cands);
    if (a) return a;
  }

  // 5. Estrada que destrava uma nova vila: escolhe a melhor pela funcao de valor.
  if (p.pieces.roads > 0 && p.pieces.settlements > 0 && canAfford(p.hand, COSTS.road)) {
    const cands: Action[] = [];
    for (const eid of state.board.edgeOrder) {
      if (state.roads[eid] || !roadConnects(state, me, eid)) continue;
      const e = state.board.edges[eid]!;
      // So estradas que abrem um vertice novo e legal (rumo a expansao).
      const opens = e.v.some(
        (far) => !state.buildings[far] && distanceRuleOk(state, far) && !vertexTouchesPlayerNetwork(state, me, far),
      );
      if (opens) cands.push({ t: 'buildRoad', edgeId: eid });
    }
    const a = bestActionByValue(state, me, cands);
    if (a) return a;
  }

  // 5b. Navio que destrava uma nova vila (Navegadores: rumo as ilhas).
  if ((p.pieces.ships ?? 0) > 0 && p.pieces.settlements > 0 && canAfford(p.hand, COSTS.ship)) {
    const ship = shipToUnlock(state, me, 'hard');
    if (ship) return { t: 'buildShip', edgeId: ship };
  }

  // 6. Oferecer troca a um humano (uma por turno) rumo a expansao.
  const offer = planTradeProposal(state, me, 'hard', humans);
  if (offer) return offer;

  // 7. Trocar com o banco rumo a expansao.
  const trade = tradeTowardGoal(state, me, 'hard');
  if (trade) return trade;

  // 8. Sem expandir agora: usar a sobra comprando carta (PV/cavaleiro).
  if (state.devDeck.length > 0 && canAfford(p.hand, COSTS.progressCard)) return { t: 'buyProgressCard' };

  // 9. Estender estrada (caca a Maior Rota).
  if (p.pieces.roads > 0 && canAfford(p.hand, COSTS.road)) {
    const road = roadToUnlock(state, me, 'hard') ?? bestRoadTowardLand(state, me, 'hard') ?? anyLegalRoad(state, me);
    if (road) return { t: 'buildRoad', edgeId: road };
  }

  // 9b. Estender navio (Navegadores).
  if ((p.pieces.ships ?? 0) > 0 && canAfford(p.hand, COSTS.ship)) {
    const ship = shipToUnlock(state, me, 'hard') ?? bestShipTowardLand(state, me, 'hard');
    if (ship) return { t: 'buildShip', edgeId: ship };
  }

  return { t: 'endTurn' };
}

// ---------------------------------------------------------------------------
// Cartas de progresso
// ---------------------------------------------------------------------------

function canPlay(state: GameState, p: Player, card: ProgressCard): boolean {
  if (state.devCardPlayedThisTurn) return false;
  const have = p.progressCards.filter((c) => c === card).length;
  const bought = p.progressCardsBoughtThisTurn.filter((c) => c === card).length;
  return have - bought > 0;
}

function robberOnMyHex(state: GameState, me: PlayerColor): boolean {
  const hex = state.board.hexes[state.blocker.hexId]!;
  return hex.corners.some((vid) => state.buildings[vid]?.owner === me);
}

function maybeKnight(state: GameState, me: PlayerColor): Action | null {
  const p = getPlayer(state, me);
  if (canPlay(state, p, 'knight') && robberOnMyHex(state, me)) return { t: 'playKnight' };
  return null;
}

function shouldPlayKnight(state: GameState, me: PlayerColor): boolean {
  if (robberOnMyHex(state, me)) return true;
  const p = getPlayer(state, me);
  const needed = Math.max(3, state.largestArmy.size + 1);
  if (state.largestArmy.owner !== me && p.knightsPlayed + 1 >= needed) return true;
  for (const hid of state.board.hexOrder) {
    if (hid === state.blocker.hexId) continue;
    const hex = state.board.hexes[hid]!;
    for (const vid of hex.corners) {
      const b = state.buildings[vid];
      if (b && b.owner !== me) {
        const total = RESOURCES.reduce((s, r) => s + getPlayer(state, b.owner).hand[r], 0);
        if (total >= 3) return true;
      }
    }
  }
  return false;
}

function planPlayCard(state: GameState, me: PlayerColor, level: Difficulty): Action | null {
  const p = getPlayer(state, me);

  // Facil so usa Cavaleiro quando o bloqueador esta em cima dele (joga mal as cartas).
  if (level === 'easy') {
    if (canPlay(state, p, 'knight') && robberOnMyHex(state, me)) return { t: 'playKnight' };
    return null;
  }

  if (canPlay(state, p, 'knight') && shouldPlayKnight(state, me)) return { t: 'playKnight' };
  if (canPlay(state, p, 'yearOfPlenty')) {
    const picks = resourcesToComplete(state, me, level);
    if (picks) return { t: 'playYearOfPlenty', resources: picks };
  }
  if (canPlay(state, p, 'roadBuilding') && p.pieces.roads > 0 && roadToUnlock(state, me, level)) {
    return { t: 'playRoadBuilding' };
  }
  if (canPlay(state, p, 'monopoly')) {
    const r = monopolyTarget(state, me);
    if (r) return { t: 'playMonopoly', resource: r };
  }
  return null;
}

function resourcesToComplete(state: GameState, me: PlayerColor, level: Difficulty): [Resource, Resource] | null {
  const p = getPlayer(state, me);
  const options: Partial<Record<Resource, number>>[] = [];
  if (bestCityTarget(state, me, level) && p.pieces.cities > 0) options.push(COSTS.city);
  if (bestSettlementTarget(state, me, level) && p.pieces.settlements > 0) options.push(COSTS.settlement);
  for (const cost of options) {
    const need: Resource[] = [];
    for (const r of RESOURCES) {
      let d = (cost[r] ?? 0) - p.hand[r];
      while (d > 0) {
        need.push(r);
        d--;
      }
    }
    if (need.length >= 1 && need.length <= 2 && need.every((r) => state.bank[r] > 0)) {
      const a = need[0]!;
      const b = need[1] ?? need[0]!;
      if (state.bank[a] > 0 && state.bank[b] > (a === b ? 1 : 0)) return [a, b];
    }
  }
  return null;
}

function monopolyTarget(state: GameState, me: PlayerColor): Resource | null {
  let best: Resource | null = null;
  let bestTotal = 3;
  for (const r of RESOURCES) {
    let total = 0;
    for (const pl of state.players) if (pl.color !== me) total += pl.hand[r];
    if (total > bestTotal) {
      bestTotal = total;
      best = r;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Bloqueador, descarte e trocas
// ---------------------------------------------------------------------------

function planBlocker(state: GameState, me: PlayerColor, level: Difficulty): Action {
  // Dificil mira o lider; medio bloqueia a maior producao; facil so evita a si.
  let leader: PlayerColor | null = null;
  if (level === 'hard') {
    let bestPts = -1;
    for (const p of state.players) {
      if (p.color === me) continue;
      const pts = publicScoreOf(state, p.color);
      if (pts > bestPts) {
        bestPts = pts;
        leader = p.color;
      }
    }
  }

  // Ladrao amigavel: so mira hexes permitidos (se houver alternativa).
  const enforceFriendly =
    state.friendlyRobber &&
    state.board.hexOrder.some((h) => h !== state.blocker.hexId && robberAllowed(state, h, me));

  // Navegadores: o bot move sempre o LADRAO (terra) — ignora hexes de mar (pirata).
  const skipHex = (hid: string): boolean =>
    hid === state.blocker.hexId || (isSeaGame(state) && state.board.hexes[hid]!.terrain === 'sea');
  let bestHex = state.board.hexOrder.find((h) => !skipHex(h) && (!enforceFriendly || robberAllowed(state, h, me)))!;
  let bestScore = -Infinity;
  for (const hid of state.board.hexOrder) {
    if (skipHex(hid)) continue;
    if (enforceFriendly && !robberAllowed(state, hid, me)) continue;
    const hex = state.board.hexes[hid]!;
    let score = 0;
    let touchesSelf = false;
    for (const vid of hex.corners) {
      const b = state.buildings[vid];
      if (!b) continue;
      if (b.owner === me) {
        touchesSelf = true;
      } else {
        const w = level === 'hard' && b.owner === leader ? 3 : 1;
        score += pip(hex.number) * (b.kind === 'city' ? 2 : 1) * w;
      }
    }
    if (level === 'easy') score = touchesSelf ? -1 : 0; // sem mira: qualquer hex livre
    else if (touchesSelf) score -= 100;
    if (score > bestScore) {
      bestScore = score;
      bestHex = hid;
    }
  }

  // Rouba do alvo: lider (dificil) senao o de mais cartas. As vitimas elegiveis
  // (adjacentes, com cartas, e >=3 PV sob ladrao amigavel) saem de robberVictims —
  // a mesma regra que o servidor aplica.
  let victim: PlayerColor | undefined;
  let mostCards = -1;
  for (const owner of robberVictims(state, bestHex, me)) {
    const total = RESOURCES.reduce((s, r) => s + getPlayer(state, owner).hand[r], 0);
    const pref = level === 'hard' && owner === leader ? total + 100 : total;
    if (pref > mostCards) {
      mostCards = pref;
      victim = owner;
    }
  }
  return { t: 'moveBlocker', hexId: bestHex, ...(victim ? { stealFrom: victim } : {}) };
}

function botColorsWithDiscard(state: GameState, isBot: IsBot): PlayerColor[] {
  return (Object.keys(state.pendingDiscards) as PlayerColor[]).filter(
    (c) => isBot(c) && (state.pendingDiscards[c] ?? 0) > 0,
  );
}

function chooseDiscard(state: GameState, color: PlayerColor): Partial<Record<Resource, number>> {
  const p = getPlayer(state, color);
  const n = state.pendingDiscards[color] ?? 0;
  const hand: Record<Resource, number> = { ...p.hand };
  const out: Partial<Record<Resource, number>> = {};
  for (let i = 0; i < n; i++) {
    let best: Resource = RESOURCES[0]!;
    for (const r of RESOURCES) if (hand[r] > hand[best]) best = r;
    hand[best] -= 1;
    out[best] = (out[best] ?? 0) + 1;
  }
  return out;
}

/**
 * Navegadores: recursos que o bot escolhe do OURO — os que mais faltam para a
 * meta de expansao mais barata (senao o mais abundante no banco). Limitado ao que
 * o banco tem (igual ao motor), para nunca escolher a mais.
 */
function chooseGold(state: GameState, color: PlayerColor): Partial<Record<Resource, number>> {
  const p = getPlayer(state, color);
  const bankTotal = RESOURCES.reduce((s, r) => s + state.bank[r], 0);
  const need = Math.min(state.pendingGold?.[color] ?? 0, bankTotal);
  const goals = expansionGoals(state, color, 'medium');
  const hand: Record<Resource, number> = { ...p.hand };
  const out: Partial<Record<Resource, number>> = {};
  const bankLeft = (r: Resource): number => state.bank[r] - (out[r] ?? 0);
  for (let i = 0; i < need; i++) {
    let pick: Resource | null = null;
    for (const cost of goals) {
      const r = RESOURCES.find((res) => (cost[res] ?? 0) - hand[res] > 0 && bankLeft(res) > 0);
      if (r) { pick = r; break; }
    }
    if (!pick) {
      for (const r of RESOURCES) if (bankLeft(r) > 0 && (pick === null || bankLeft(r) > bankLeft(pick))) pick = r;
    }
    if (!pick) break;
    hand[pick] += 1;
    out[pick] = (out[pick] ?? 0) + 1;
  }
  return out;
}

function sumCounts(rec: Partial<Record<Resource, number>>): number {
  let s = 0;
  for (const r of RESOURCES) s += rec[r] ?? 0;
  return s;
}

/** Mao resultante para quem ACEITA a troca: recebe `give` e entrega `want`. */
function handAfterTrade(hand: Record<Resource, number>, trade: TradeOffer): Record<Resource, number> {
  const h = { ...hand };
  for (const r of RESOURCES) h[r] += (trade.give[r] ?? 0) - (trade.want[r] ?? 0);
  return h;
}

/** Cartas que faltam na `hand` para pagar `cost`. */
function missingFor(hand: Record<Resource, number>, cost: Partial<Record<Resource, number>>): number {
  let m = 0;
  for (const r of RESOURCES) m += Math.max(0, (cost[r] ?? 0) - hand[r]);
  return m;
}

/**
 * Distancia (cartas faltantes) da `hand` a meta de expansao mais proxima do bot;
 * Infinity se ele nao tem meta construivel agora. As metas dependem do TABULEIRO e
 * das pecas (nao da mao), entao uma troca so muda a distancia, nunca o conjunto.
 */
function goalDistance(state: GameState, me: PlayerColor, level: Difficulty, hand: Record<Resource, number>): number {
  let best = Infinity;
  for (const cost of expansionGoals(state, me, level)) best = Math.min(best, missingFor(hand, cost));
  return best;
}

/**
 * O proponente pode fechar o jogo (a <=2 PV de vencer) ou e o lider destacado a
 * minha frente? O bot dificil recusa negociar com ele — nao se entrega um recurso a
 * quem esta prestes a ganhar.
 */
function proposerIsThreat(state: GameState, me: PlayerColor, from: PlayerColor): boolean {
  if (from === me) return false;
  const fromPts = publicScoreOf(state, from);
  if (fromPts >= state.victoryTarget - 2) return true; // a <=2 PV: qualquer carta fecha o jogo
  let maxOther = 0;
  for (const p of state.players) if (p.color !== from) maxOther = Math.max(maxOther, publicScoreOf(state, p.color));
  return fromPts >= maxOther && fromPts >= publicScoreOf(state, me) + 2; // lider 2+ a minha frente
}

/**
 * O bot deve aceitar esta troca proposta por outro jogador? Antes ele aceitava
 * QUALQUER troca com contagem de cartas nao-negativa (`totalGet >= totalGive`) — o
 * que era permissivo demais: um humano dava um recurso inutil e levava o minerio de
 * que o bot precisava. Agora:
 * - facil segue permissivo DE PROPOSITO (oponente iniciante);
 * - medio/dificil so aceitam quando a troca APROXIMA de construir algo, ou e um
 *   ganho liquido de cartas que nao afasta de nenhuma meta — nunca entregando um
 *   recurso necessario num swap lateral;
 * - dificil ainda recusa alimentar quem esta perto de vencer.
 */
function tradeFavorable(state: GameState, c: PlayerColor, trade: TradeOffer, level: Difficulty): boolean {
  const p = getPlayer(state, c);
  if (!canAfford(p.hand, trade.want)) return false;
  const get = sumCounts(trade.give);
  const give = sumCounts(trade.want);
  if (get <= 0) return false;

  // Facil: aceita qualquer troca que nao perca cartas (proposital — joga mal).
  if (level === 'easy') return get >= give;

  // Medio/dificil: nunca dar mais cartas do que recebe.
  if (get < give) return false;
  // Dificil: nao ajude quem pode fechar o jogo.
  if (level === 'hard' && proposerIsThreat(state, c, trade.from)) return false;

  const before = goalDistance(state, c, level, p.hand);
  const after = goalDistance(state, c, level, handAfterTrade(p.hand, trade));
  // Aproxima de construir algo: bom negocio.
  if (after < before) return true;
  // Senao, so aceita ganho liquido de cartas que nao me afaste de uma meta viva
  // (liquidez sem entregar recurso critico).
  return get > give && before !== Infinity && after <= before;
}

// ===========================================================================
// FUTURE FEATURES — proximos passos da IA (ver memoria catan-ai-research)
// ===========================================================================
//
// FEITO (passos 1-2): funcao de valor `evaluate()` + ValueFunctionPlayer 1-ply no
// nivel "dificil" (`planMainByValue` / `bestSetupVertexByValue`). easy/medio intactos.
//
// FEITO (passo 3): no de ACASO sobre os dados — o leaf do nivel dificil passou de
//   `evaluate(estado)` para `expectedValue(estado)` = media de `evaluate` sobre as
//   somas 2..12 ponderadas pela probabilidade (modela a incerteza do dado como o
//   AlphaBetaPlayer n=2 do catanatron). Como uma rolagem so muda a MINHA mao, o
//   valor esperado e exato e barato (sem clonar): `evaluate` + media da variacao dos
//   termos de mao. Ganho medido no self-play: ~33.8% -> ~35.0% (baseline 25%).
//   Nota: e um DESEMPATE forte de colocacao (prefere 6/8, evita risco do 7); nao
//   troca a ORDEM de prioridades (fazer isso — 1-ply sobre TIPOS de acao — regrediu
//   p/ 21.7% antes; ver catan-ai-research). Nao ha no MIN de adversario (turnos
//   inteiros dos oponentes seriam caros; a producao inimiga entra estatica em
//   `enemyProduction`). Alpha-beta nao se aplica a um no de acaso de 11 ramos.
//
// PROXIMO (passo 3b, maior ganho porem mais caro/arriscado): no MIN de adversario
//   (melhor resposta do lider) e/ou um 2o ply MAX proprio (construir apos a rolagem)
//   com poda; exigiria orcamento de tempo e cuidado p/ nao regredir o hibrido.
//
// PASSO 4 — Auto-ajuste de pesos por self-play:
//   Como o engine e deterministico e gravamos partidas (apps/web/src/ui/replays.ts),
//   rodar N partidas bot-vs-bot variando os pesos `W` (hill-climbing / coordinate
//   descent ou um GA simples) e selecionar o conjunto com maior win-rate contra a
//   versao atual. Usar o harness de self-play (packages/bot/test) como base e
//   fixar seeds para reprodutibilidade.
