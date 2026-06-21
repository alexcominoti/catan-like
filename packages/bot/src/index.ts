/**
 * Bot heuristico (guloso, mas sensato). Puro: nao tem I/O nem aleatoriedade.
 *
 * `planBotAction` olha o estado e devolve a proxima acao que um bot deveria
 * tomar (jogada do turno, descarte do 7, mover bloqueador, ou aceitar uma troca
 * favoravel). Retorna null quando nenhum bot precisa agir agora.
 *
 * O reducer do engine continua sendo a unica autoridade: o bot so sugere acoes
 * legais; quem aplica e o `reduce`.
 */
import {
  COSTS,
  RESOURCES,
  TERRAIN_RESOURCE,
  distanceRuleOk,
  maritimeRate,
  roadConnects,
  vertexTouchesPlayerRoad,
  type Action,
  type GameState,
  type Player,
  type PlayerColor,
  type ProgressCard,
  type Resource,
  type TradeOffer,
} from '@hexgame/engine';

export type IsBot = (color: PlayerColor) => boolean;

export interface BotMove {
  by: PlayerColor;
  action: Action;
}

export function planBotAction(state: GameState, isBot: IsBot): BotMove | null {
  if (state.phase === 'ended') return null;

  // 1. Descartes pendentes de bots (apos um 7).
  if (state.phase === 'discard') {
    const color = botColorsWithDiscard(state, isBot)[0];
    if (color) return { by: color, action: { t: 'discard', resources: chooseDiscard(state, color) } };
    return null; // espera os humanos descartarem
  }

  // 2. Respostas de troca: o bot SO aceita (uma vez) quando favoravel; nunca
  //    devolve "recusar" — assim o loop nao fica preso.
  if (state.activeTrade) {
    const t = state.activeTrade;
    for (const c of t.to) {
      if (isBot(c) && !t.accepted.includes(c) && tradeFavorable(state, c, t)) {
        return { by: c, action: { t: 'respondTrade', accept: true } };
      }
    }
  }

  const me = state.currentPlayer;
  if (!isBot(me)) return null;

  switch (state.phase) {
    case 'moveBlocker':
      return { by: me, action: planBlocker(state, me) };
    case 'setup1':
    case 'setup2':
      return state.setupLastVertex
        ? { by: me, action: { t: 'placeRoad', edgeId: bestSetupRoad(state, me) } }
        : { by: me, action: { t: 'placeSettlement', vertexId: bestSetupVertex(state) } };
    case 'roll': {
      const knight = maybeKnight(state, me);
      return { by: me, action: knight ?? { t: 'rollDice' } };
    }
    case 'main':
      return { by: me, action: planMain(state, me) };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Avaliacao de posicoes
// ---------------------------------------------------------------------------

function pip(n: number | null): number {
  return n === null ? 0 : 6 - Math.abs(7 - n);
}

/** Valor de um vertice: soma das probabilidades dos hexes + variedade. */
function vertexValue(state: GameState, vid: string): number {
  const v = state.board.vertices[vid];
  if (!v) return 0;
  let sum = 0;
  const res = new Set<Resource>();
  for (const hid of v.hexes) {
    const hex = state.board.hexes[hid]!;
    sum += pip(hex.number);
    const r = TERRAIN_RESOURCE[hex.terrain];
    if (r) res.add(r);
  }
  return sum + res.size * 0.6;
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

function bestSetupVertex(state: GameState): string {
  let best = state.board.vertexOrder[0]!;
  let bestScore = -1;
  for (const vid of state.board.vertexOrder) {
    if (!distanceRuleOk(state, vid)) continue;
    const s = vertexValue(state, vid);
    if (s > bestScore) {
      bestScore = s;
      best = vid;
    }
  }
  return best;
}

function bestSetupRoad(state: GameState, me: PlayerColor): string {
  const last = state.setupLastVertex!;
  const v = state.board.vertices[last]!;
  let best = v.edges.find((e) => !state.roads[e]) ?? v.edges[0]!;
  let bestScore = -1;
  for (const eid of v.edges) {
    if (state.roads[eid]) continue;
    const e = state.board.edges[eid]!;
    const other = e.v[0] === last ? e.v[1] : e.v[0];
    const s = vertexValue(state, other); // estrada aponta para um bom vizinho
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

function planMain(state: GameState, me: PlayerColor): Action {
  const p = getPlayer(state, me);

  // 1. Jogar uma carta util (uma por turno).
  const card = planPlayCard(state, me);
  if (card) return card;

  // 2. Estrada gratis pendente (carta "2 Estradas").
  if (state.pendingFreeRoads > 0 && p.pieces.roads > 0) {
    const road = roadToUnlock(state, me) ?? anyLegalRoad(state, me);
    if (road) return { t: 'buildRoad', edgeId: road };
  }

  // 3. Cidade (melhor retorno por ponto).
  const city = bestCityTarget(state, me);
  if (city && p.pieces.cities > 0 && canAfford(p.hand, COSTS.city)) {
    return { t: 'buildCity', vertexId: city };
  }

  // 4. Vila.
  const settle = bestSettlementTarget(state, me);
  if (settle && p.pieces.settlements > 0 && canAfford(p.hand, COSTS.settlement)) {
    return { t: 'buildSettlement', vertexId: settle };
  }

  // 5. Estrada que destrava uma nova vila.
  if (p.pieces.roads > 0 && p.pieces.settlements > 0 && canAfford(p.hand, COSTS.road)) {
    const road = roadToUnlock(state, me);
    if (road) return { t: 'buildRoad', edgeId: road };
  }

  // 6. Comprar carta com a sobra (VP/cavaleiro -> pontos).
  if (state.devDeck.length > 0 && canAfford(p.hand, COSTS.progressCard)) {
    return { t: 'buyProgressCard' };
  }

  // 7. Trocar 4:1 / porto rumo a meta alcancavel de maior prioridade
  //    (cidade > vila > carta). Garante progresso de pontos ao longo dos turnos.
  const trade = tradeTowardGoal(state, me);
  if (trade) return trade;

  // 8. Sem ore/expansao: estender estrada (caca a Estrada Mais Longa; usa so
  //    madeira+tijolo). Mantem o jogo avancando mesmo com o banco escasso.
  if (p.pieces.roads > 0 && canAfford(p.hand, COSTS.road)) {
    const road = roadToUnlock(state, me) ?? anyLegalRoad(state, me);
    if (road) return { t: 'buildRoad', edgeId: road };
  }

  return { t: 'endTurn' };
}

function bestCityTarget(state: GameState, me: PlayerColor): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const [vid, b] of Object.entries(state.buildings)) {
    if (b.owner !== me || b.kind !== 'settlement') continue;
    const s = vertexValue(state, vid);
    if (s > bestScore) {
      bestScore = s;
      best = vid;
    }
  }
  return best;
}

function bestSettlementTarget(state: GameState, me: PlayerColor): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const vid of state.board.vertexOrder) {
    if (!distanceRuleOk(state, vid)) continue;
    if (!vertexTouchesPlayerRoad(state, me, vid)) continue;
    const s = vertexValue(state, vid);
    if (s > bestScore) {
      bestScore = s;
      best = vid;
    }
  }
  return best;
}

/** Estrada legal cujo extremo distante e uma nova vila possivel. */
function roadToUnlock(state: GameState, me: PlayerColor): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const eid of state.board.edgeOrder) {
    if (state.roads[eid]) continue;
    if (!roadConnects(state, me, eid)) continue;
    const e = state.board.edges[eid]!;
    for (const far of e.v) {
      if (state.buildings[far]) continue;
      if (!distanceRuleOk(state, far)) continue;
      if (vertexTouchesPlayerRoad(state, me, far)) continue; // ja alcancado
      const s = vertexValue(state, far);
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
 * Troca com o banco rumo a meta alcancavel de maior prioridade (cidade > vila >
 * carta): pega um recurso faltante (com estoque no banco) usando a sobra de
 * outro. Uma troca por chamada; ao longo dos turnos converge para a construcao.
 */
function tradeTowardGoal(state: GameState, me: PlayerColor): Action | null {
  const p = getPlayer(state, me);
  const goals: { cost: Partial<Record<Resource, number>>; ok: boolean }[] = [
    { cost: COSTS.city, ok: !!bestCityTarget(state, me) && p.pieces.cities > 0 },
    { cost: COSTS.settlement, ok: !!bestSettlementTarget(state, me) && p.pieces.settlements > 0 },
    { cost: COSTS.progressCard, ok: state.devDeck.length > 0 },
  ];
  for (const g of goals) {
    if (!g.ok) continue;
    let want: Resource | null = null;
    for (const r of RESOURCES) {
      if ((g.cost[r] ?? 0) - p.hand[r] > 0 && state.bank[r] > 0) {
        want = r;
        break;
      }
    }
    if (!want) continue; // ja tem os recursos desta meta
    for (const give of RESOURCES) {
      if (give === want) continue;
      const rate = maritimeRate(state, me, give);
      const spare = p.hand[give] - (g.cost[give] ?? 0);
      if (spare >= rate) return { t: 'tradeBank', give, want };
    }
  }
  return null;
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

/** Vale a pena jogar Cavaleiro: tirar bloqueador de mim, caca ao exercito ou roubo. */
function shouldPlayKnight(state: GameState, me: PlayerColor): boolean {
  if (robberOnMyHex(state, me)) return true;
  const p = getPlayer(state, me);
  const needed = Math.max(3, state.largestArmy.size + 1);
  const chaseArmy = state.largestArmy.owner !== me && p.knightsPlayed + 1 >= needed;
  if (chaseArmy) return true;
  // Existe um roubo bom (adversario com >=3 cartas em um hex que da pra bloquear)?
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

function planPlayCard(state: GameState, me: PlayerColor): Action | null {
  const p = getPlayer(state, me);

  // Cavaleiro: tira o bloqueador de cima de mim, caca o Maior Exercito,
  // ou aproveita um bom roubo.
  if (canPlay(state, p, 'knight') && shouldPlayKnight(state, me)) return { t: 'playKnight' };

  // +2 Recursos: completa uma cidade/vila alvo.
  if (canPlay(state, p, 'yearOfPlenty')) {
    const picks = resourcesToComplete(state, me);
    if (picks) return { t: 'playYearOfPlenty', resources: picks };
  }

  // 2 Estradas: quando ha vilas a destravar.
  if (canPlay(state, p, 'roadBuilding') && p.pieces.roads > 0 && roadToUnlock(state, me)) {
    return { t: 'playRoadBuilding' };
  }

  // Monopolio: se algum recurso esta muito nas maos dos adversarios.
  if (canPlay(state, p, 'monopoly')) {
    const r = monopolyTarget(state, me);
    if (r) return { t: 'playMonopoly', resource: r };
  }
  return null;
}

/** Dois recursos que completariam a cidade ou a vila alvo (deficit <= 2). */
function resourcesToComplete(state: GameState, me: PlayerColor): [Resource, Resource] | null {
  const p = getPlayer(state, me);
  const options: Partial<Record<Resource, number>>[] = [];
  if (bestCityTarget(state, me) && p.pieces.cities > 0) options.push(COSTS.city);
  if (bestSettlementTarget(state, me) && p.pieces.settlements > 0) options.push(COSTS.settlement);
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
  let bestTotal = 3; // so vale a pena a partir de 4 cartas no total dos outros
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

function planBlocker(state: GameState, me: PlayerColor): Action {
  let bestHex = state.board.hexOrder.find((h) => h !== state.blocker.hexId)!;
  let bestScore = -1;
  for (const hid of state.board.hexOrder) {
    if (hid === state.blocker.hexId) continue;
    const hex = state.board.hexes[hid]!;
    let opp = 0;
    let touchesSelf = false;
    for (const vid of hex.corners) {
      const b = state.buildings[vid];
      if (!b) continue;
      if (b.owner === me) touchesSelf = true;
      else opp += pip(hex.number) * (b.kind === 'city' ? 2 : 1);
    }
    const score = touchesSelf ? opp - 100 : opp; // evita travar a si mesmo
    if (score > bestScore) {
      bestScore = score;
      bestHex = hid;
    }
  }
  // Rouba do adversario com mais cartas adjacente ao hex escolhido.
  const hex = state.board.hexes[bestHex]!;
  let victim: PlayerColor | undefined;
  let mostCards = 0;
  for (const vid of hex.corners) {
    const b = state.buildings[vid];
    if (!b || b.owner === me) continue;
    const total = RESOURCES.reduce((s, r) => s + getPlayer(state, b.owner).hand[r], 0);
    if (total > mostCards) {
      mostCards = total;
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
