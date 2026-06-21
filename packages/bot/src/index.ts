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
  maritimeRate,
  publicScoreOf,
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
      return state.setupLastVertex
        ? { by: me, action: { t: 'placeRoad', edgeId: bestSetupRoad(state, me) } }
        : { by: me, action: { t: 'placeSettlement', vertexId: bestSetupVertex(state, level) } };
    case 'roll': {
      const knight = maybeKnight(state, me);
      return { by: me, action: knight ?? { t: 'rollDice' } };
    }
    case 'main':
      return { by: me, action: planMain(state, me, level, humans) };
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
    const road = roadToUnlock(state, me, level) ?? anyLegalRoad(state, me);
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
    const road = roadToUnlock(state, me, level) ?? anyLegalRoad(state, me);
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

  let bestHex = state.board.hexOrder.find((h) => h !== state.blocker.hexId)!;
  let bestScore = -Infinity;
  for (const hid of state.board.hexOrder) {
    if (hid === state.blocker.hexId) continue;
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
  const hex = state.board.hexes[bestHex]!;
  let victim: PlayerColor | undefined;
  let mostCards = -1;
  for (const vid of hex.corners) {
    const b = state.buildings[vid];
    if (!b || b.owner === me) continue;
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
