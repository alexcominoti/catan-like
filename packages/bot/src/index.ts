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
  distanceRuleOk,
  handTotal,
  longestRoadLength,
  maritimeRate,
  publicScoreOf,
  reduce,
  robberAllowed,
  roadConnects,
  scoreOf,
  vertexTouchesPlayerRoad,
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

  // 2. Respostas de troca: o bot SO aceita (uma vez) quando favoravel.
  if (state.activeTrade) {
    const t = state.activeTrade;
    for (const c of t.to) {
      if (isBot(c) && !t.accepted.includes(c) && tradeFavorable(state, c, t)) {
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

function bestSetupVertex(state: GameState, level: Difficulty): string {
  const valid = state.board.vertexOrder.filter((vid) => distanceRuleOk(state, vid));
  if (valid.length === 0) return state.board.vertexOrder[0]!;
  const scored = valid.map((vid) => ({ vid, s: vertexValue(state, vid, level) })).sort((a, b) => b.s - a.s);
  // Facil escolhe um vertice mediano (jogo mais fraco); os demais, o melhor.
  if (level === 'easy') return scored[Math.floor(scored.length / 2)]!.vid;
  return scored[0]!.vid;
}

function bestSetupRoad(state: GameState, _me: PlayerColor): string {
  const last = state.setupLastVertex!;
  const v = state.board.vertices[last]!;
  let best = v.edges.find((e) => !state.roads[e]) ?? v.edges[0]!;
  let bestScore = -1;
  for (const eid of v.edges) {
    if (state.roads[eid]) continue;
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

  // 2. Estrada gratis pendente (carta "2 Estradas").
  if (state.pendingFreeRoads > 0 && p.pieces.roads > 0) {
    const road = roadToUnlock(state, me, level) ?? bestRoadTowardLand(state, me, level) ?? anyLegalRoad(state, me);
    if (road) return { t: 'buildRoad', edgeId: road };
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

  // 9. Estender estrada (caca a Estrada Mais Longa) — mantem o jogo avancando.
  if (p.pieces.roads > 0 && canAfford(p.hand, COSTS.road)) {
    const road = roadToUnlock(state, me, level) ?? bestRoadTowardLand(state, me, level) ?? anyLegalRoad(state, me);
    if (road) return { t: 'buildRoad', edgeId: road };
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
  if (humans.length === 0 || state.tradeOffersThisTurn > 0) return null;
  const p = getPlayer(state, me);
  for (const cost of expansionGoals(state, me, level)) {
    const needed = RESOURCES.find((r) => (cost[r] ?? 0) - p.hand[r] > 0);
    if (!needed) continue;
    const give = RESOURCES.find(
      (r) => r !== needed && p.hand[r] - (cost[r] ?? 0) >= 1 && maritimeRate(state, me, r) >= 3,
    );
    if (!give) continue;
    return { t: 'proposeTrade', give: { [give]: 1 }, want: { [needed]: 1 }, to: humans };
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
    if (!vertexTouchesPlayerRoad(state, me, vid)) continue;
    const s = vertexValue(state, vid, level);
    if (s > bestScore) {
      bestScore = s;
      best = vid;
    }
  }
  return best;
}

function roadToUnlock(state: GameState, me: PlayerColor, level: Difficulty): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const eid of state.board.edgeOrder) {
    if (state.roads[eid]) continue;
    if (!roadConnects(state, me, eid)) continue;
    const e = state.board.edges[eid]!;
    for (const far of e.v) {
      if (state.buildings[far]) continue;
      if (!distanceRuleOk(state, far)) continue;
      if (vertexTouchesPlayerRoad(state, me, far)) continue;
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
    if (!state.roads[eid] && roadConnects(state, me, eid)) return eid;
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
    if (state.roads[eid] || !roadConnects(state, me, eid)) continue;
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
    if (vertexTouchesPlayerRoad(state, me, vid)) {
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
    W.longestRoadLen * longestRoadLength(state, me) +
    W.knights * p.knightsPlayed +
    W.devCards * p.progressCards.length
  );
}

/** Vertice de setup que maximiza a funcao de valor (simula a colocacao). */
function bestSetupVertexByValue(state: GameState, me: PlayerColor): string {
  const valid = state.board.vertexOrder.filter((vid) => distanceRuleOk(state, vid));
  if (valid.length === 0) return state.board.vertexOrder[0]!;
  let best = valid[0]!;
  let bestV = -Infinity;
  for (const vid of valid) {
    const r = reduce(state, me, { t: 'placeSettlement', vertexId: vid });
    if (!r.ok) continue;
    const v = evaluate(r.state, me);
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
    const v = evaluate(r.state, me);
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

  // 2. Estrada gratis pendente (carta "2 Estradas").
  if (state.pendingFreeRoads > 0 && p.pieces.roads > 0) {
    const road = roadToUnlock(state, me, 'hard') ?? bestRoadTowardLand(state, me, 'hard') ?? anyLegalRoad(state, me);
    if (road) return { t: 'buildRoad', edgeId: road };
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
      if (!state.buildings[vid] && distanceRuleOk(state, vid) && vertexTouchesPlayerRoad(state, me, vid)) {
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
        (far) => !state.buildings[far] && distanceRuleOk(state, far) && !vertexTouchesPlayerRoad(state, me, far),
      );
      if (opens) cands.push({ t: 'buildRoad', edgeId: eid });
    }
    const a = bestActionByValue(state, me, cands);
    if (a) return a;
  }

  // 6. Oferecer troca a um humano (uma por turno) rumo a expansao.
  const offer = planTradeProposal(state, me, 'hard', humans);
  if (offer) return offer;

  // 7. Trocar com o banco rumo a expansao.
  const trade = tradeTowardGoal(state, me, 'hard');
  if (trade) return trade;

  // 8. Sem expandir agora: usar a sobra comprando carta (PV/cavaleiro).
  if (state.devDeck.length > 0 && canAfford(p.hand, COSTS.progressCard)) return { t: 'buyProgressCard' };

  // 9. Estender estrada (caca a Estrada Mais Longa).
  if (p.pieces.roads > 0 && canAfford(p.hand, COSTS.road)) {
    const road = roadToUnlock(state, me, 'hard') ?? bestRoadTowardLand(state, me, 'hard') ?? anyLegalRoad(state, me);
    if (road) return { t: 'buildRoad', edgeId: road };
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

  let bestHex = state.board.hexOrder.find((h) => h !== state.blocker.hexId && (!enforceFriendly || robberAllowed(state, h, me)))!;
  let bestScore = -Infinity;
  for (const hid of state.board.hexOrder) {
    if (hid === state.blocker.hexId) continue;
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

  // Rouba do alvo: lider (dificil) senao o de mais cartas adjacente ao hex.
  // Com ladrao amigavel, nao rouba de quem tem <3 PV.
  const hex = state.board.hexes[bestHex]!;
  let victim: PlayerColor | undefined;
  let mostCards = -1;
  for (const vid of hex.corners) {
    const b = state.buildings[vid];
    if (!b || b.owner === me) continue;
    if (state.friendlyRobber && publicScoreOf(state, b.owner) < 3) continue;
    const total = RESOURCES.reduce((s, r) => s + getPlayer(state, b.owner).hand[r], 0);
    const pref = level === 'hard' && b.owner === leader ? total + 100 : total;
    if (total > 0 && pref > mostCards) {
      mostCards = pref;
      victim = b.owner;
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

function tradeFavorable(state: GameState, c: PlayerColor, trade: TradeOffer): boolean {
  const p = getPlayer(state, c);
  if (!canAfford(p.hand, trade.want)) return false;
  const totalGet = (Object.values(trade.give) as number[]).reduce((s, n) => s + (n ?? 0), 0);
  const totalGive = (Object.values(trade.want) as number[]).reduce((s, n) => s + (n ?? 0), 0);
  return totalGet > 0 && totalGet >= totalGive;
}

// ===========================================================================
// FUTURE FEATURES — proximos passos da IA (ver memoria catan-ai-research)
// ===========================================================================
//
// FEITO (passos 1-2): funcao de valor `evaluate()` + ValueFunctionPlayer 1-ply no
// nivel "dificil" (`planMainByValue` / `bestSetupVertexByValue`). easy/medio intactos.
//
// PASSO 3 — Busca expectimax de profundidade 2 (nivel "mestre"):
//   Sobre a melhor jogada, ramificar pelos resultados dos dados 2..12 ponderados
//   pela probabilidade (2/12:1, ... 7:6, ... ), pegando o valor ESPERADO dos
//   estados-filhos (como o AlphaBetaPlayer n=2 do catanatron, que modela a
//   incerteza do dado/roubo/compra). Alpha-beta para podar. Aproveitar que o
//   `reduce` e puro/deterministico e ja temos `evaluate()` como folha.
//
// PASSO 4 — Auto-ajuste de pesos por self-play:
//   Como o engine e deterministico e gravamos partidas (apps/web/src/ui/replays.ts),
//   rodar N partidas bot-vs-bot variando os pesos `W` (hill-climbing / coordinate
//   descent ou um GA simples) e selecionar o conjunto com maior win-rate contra a
//   versao atual. Usar o harness de self-play (packages/bot/test) como base e
//   fixar seeds para reprodutibilidade.
