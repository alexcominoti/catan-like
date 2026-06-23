import { nextInt, rollDie } from './rng.js';
import {
  COSTS,
  LARGEST_ARMY_MIN,
  LONGEST_ROAD_MIN,
  canAfford,
  computeProduction,
  distanceRuleOk,
  getPlayer,
  handTotal,
  longestRoadLength,
  maritimeRate,
  payToBank,
  publicScoreOf,
  roadConnects,
  robberAllowed,
  scoreOf,
  vertexTouchesPlayerRoad,
} from './rules.js';
import type {
  Action,
  GameEvent,
  GameState,
  PlayerColor,
  ProgressCard,
  ReduceResult,
  Resource,
} from './types.js';
import { RESOURCES } from './types.js';

function ok(state: GameState, events: GameEvent[]): ReduceResult {
  return { ok: true, state, events };
}
function err(error: string): ReduceResult {
  return { ok: false, error };
}
function clone(state: GameState): GameState {
  // O GameState e 100% serializavel em JSON (sem funcoes/Maps/Set), entao um
  // clone via JSON mantem o engine portavel (navegador e Node) e puro.
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/**
 * Funcao central, pura e deterministica.
 * Dado (estado, quem age, acao) -> proximo estado + eventos, ou erro.
 */
export function reduce(state: GameState, by: PlayerColor, action: Action): ReduceResult {
  if (state.phase === 'ended') return err('A partida ja terminou.');

  switch (action.t) {
    case 'placeSettlement':
      return placeSetupSettlement(state, by, action.vertexId);
    case 'placeRoad':
      return placeSetupRoad(state, by, action.edgeId);
    case 'rollDice':
      return rollDice(state, by);
    case 'buildRoad':
      return buildRoad(state, by, action.edgeId);
    case 'buildSettlement':
      return buildSettlement(state, by, action.vertexId);
    case 'buildCity':
      return buildCity(state, by, action.vertexId);
    case 'buyProgressCard':
      return buyProgressCard(state, by);
    case 'tradeBank':
      return tradeBank(state, by, action.give, action.want);
    case 'discard':
      return discard(state, by, action.resources);
    case 'moveBlocker':
      return moveBlocker(state, by, action.hexId, action.stealFrom);
    case 'playKnight':
      return playKnight(state, by);
    case 'playRoadBuilding':
      return playRoadBuilding(state, by);
    case 'playYearOfPlenty':
      return playYearOfPlenty(state, by, action.resources);
    case 'playMonopoly':
      return playMonopoly(state, by, action.resource);
    case 'proposeTrade':
      return proposeTrade(state, by, action.give, action.want, action.to);
    case 'counterTrade':
      return counterTrade(state, by, action.give, action.want);
    case 'respondTrade':
      return respondTrade(state, by, action.accept);
    case 'confirmTrade':
      return confirmTrade(state, by, action.with);
    case 'cancelTrade':
      return cancelTrade(state, by);
    case 'endTurn':
      return endTurn(state, by);
    default:
      return err('Acao desconhecida.');
  }
}

// ---------------------------------------------------------------------------
// Setup (serpente)
// ---------------------------------------------------------------------------

function placeSetupSettlement(state: GameState, by: PlayerColor, vertexId: string): ReduceResult {
  if (state.phase !== 'setup1' && state.phase !== 'setup2') return err('Fora da fase de setup.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  if (state.setupLastVertex) return err('Voce ja colocou a vila; agora coloque a estrada.');
  if (!state.board.vertices[vertexId]) return err('Vertice inexistente.');
  if (!distanceRuleOk(state, vertexId)) return err('Vertice ocupado ou viola a regra de distancia.');

  const next = clone(state);
  const p = getPlayer(next, by);
  if (p.pieces.settlements <= 0) return err('Sem vilas no estoque.');
  p.pieces.settlements -= 1;
  next.buildings[vertexId] = { kind: 'settlement', owner: by, vertexId };
  next.setupLastVertex = vertexId;

  const events: GameEvent[] = [{ t: 'built', kind: 'settlement', owner: by, id: vertexId }];

  // Na segunda rodada de setup, a vila gera recursos iniciais.
  if (next.phase === 'setup2') {
    const v = next.board.vertices[vertexId]!;
    const gains: Partial<Record<Resource, number>> = {};
    for (const hid of v.hexes) {
      const hex = next.board.hexes[hid]!;
      const res = resourceOf(hex.terrain);
      if (!res) continue;
      if (next.bank[res] > 0) {
        p.hand[res] += 1;
        next.bank[res] -= 1;
        gains[res] = (gains[res] ?? 0) + 1;
      }
    }
    if (Object.keys(gains).length > 0) {
      const allGains = {} as Record<PlayerColor, Partial<Record<Resource, number>>>;
      for (const pl of next.players) allGains[pl.color] = pl.color === by ? gains : {};
      events.push({ t: 'produced', gains: allGains });
    }
  }

  return ok(next, events);
}

function placeSetupRoad(state: GameState, by: PlayerColor, edgeId: string): ReduceResult {
  if (state.phase !== 'setup1' && state.phase !== 'setup2') return err('Fora da fase de setup.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  if (!state.setupLastVertex) return err('Coloque a vila antes da estrada.');
  const edge = state.board.edges[edgeId];
  if (!edge) return err('Aresta inexistente.');
  if (state.roads[edgeId]) return err('Aresta ja ocupada.');
  if (!edge.v.includes(state.setupLastVertex)) {
    return err('A estrada precisa tocar a vila recem-colocada.');
  }

  const next = clone(state);
  const p = getPlayer(next, by);
  if (p.pieces.roads <= 0) return err('Sem estradas no estoque.');
  p.pieces.roads -= 1;
  next.roads[edgeId] = { owner: by, edgeId };

  const events: GameEvent[] = [{ t: 'built', kind: 'road', owner: by, id: edgeId }];
  advanceSetup(next, events);
  return ok(next, events);
}

function advanceSetup(state: GameState, events: GameEvent[]): void {
  state.setupLastVertex = null;
  state.setupStep += 1;
  const order = state.players;
  if (state.setupStep < order.length) {
    state.phase = 'setup1';
    state.currentPlayer = order[state.setupStep]!.color;
  } else if (state.setupStep < order.length * 2) {
    state.phase = 'setup2';
    state.currentPlayer = order[order.length * 2 - 1 - state.setupStep]!.color;
  } else {
    state.phase = 'roll';
    state.currentPlayer = order[0]!.color;
    events.push({ t: 'turnEnded', next: order[0]!.color });
  }
}

// ---------------------------------------------------------------------------
// Rolar dados + producao + regra do 7
// ---------------------------------------------------------------------------

function rollDice(state: GameState, by: PlayerColor): ReduceResult {
  if (state.phase !== 'roll') return err('Nao e hora de rolar.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');

  const next = clone(state);
  const d1 = rollDie(next.rng);
  const d2 = rollDie(d1.rng);
  next.rng = d2.rng;
  const dice: [number, number] = [d1.value, d2.value];
  next.dice = dice;
  const sum = dice[0] + dice[1];
  const events: GameEvent[] = [{ t: 'diceRolled', dice, sum }];

  if (sum === 7) {
    // Descarte para quem tem mais de 7 cartas.
    const pending: Partial<Record<PlayerColor, number>> = {};
    const mustDiscard: { color: PlayerColor; count: number }[] = [];
    for (const p of next.players) {
      const total = handTotal(p);
      if (total > next.discardLimit) {
        const count = Math.floor(total / 2);
        pending[p.color] = count;
        mustDiscard.push({ color: p.color, count });
      }
    }
    next.pendingDiscards = pending;
    next.returnPhaseAfterBlocker = 'main';
    if (mustDiscard.length > 0) {
      next.phase = 'discard';
      events.push({ t: 'mustDiscard', players: mustDiscard });
    } else {
      next.phase = 'moveBlocker';
    }
    return ok(next, events);
  }

  // Producao normal.
  const gains = computeProduction(next, sum);
  for (const p of next.players) {
    const g = gains[p.color];
    for (const res of RESOURCES) {
      const amt = g[res] ?? 0;
      if (amt > 0) {
        p.hand[res] += amt;
        next.bank[res] -= amt;
      }
    }
  }
  events.push({ t: 'produced', gains });
  next.phase = 'main';
  return ok(next, events);
}

function discard(
  state: GameState,
  by: PlayerColor,
  resources: Partial<Record<Resource, number>>,
): ReduceResult {
  if (state.phase !== 'discard') return err('Nao e hora de descartar.');
  const required = state.pendingDiscards[by];
  if (!required) return err('Voce nao precisa descartar.');
  const total = (Object.values(resources) as number[]).reduce((s, n) => s + (n ?? 0), 0);
  if (total !== required) return err(`Voce precisa descartar exatamente ${required} cartas.`);

  const next = clone(state);
  const p = getPlayer(next, by);
  for (const [r, n] of Object.entries(resources) as [Resource, number][]) {
    if ((n ?? 0) < 0) return err('Quantidade invalida.');
    if (p.hand[r] < (n ?? 0)) return err('Voce nao tem essas cartas.');
  }
  for (const [r, n] of Object.entries(resources) as [Resource, number][]) {
    p.hand[r] -= n ?? 0;
    next.bank[r] += n ?? 0;
  }
  delete next.pendingDiscards[by];

  const events: GameEvent[] = [{ t: 'discarded', owner: by }];
  if (Object.keys(next.pendingDiscards).length === 0) {
    next.phase = 'moveBlocker';
  }
  return ok(next, events);
}

function moveBlocker(
  state: GameState,
  by: PlayerColor,
  hexId: string,
  stealFrom?: PlayerColor,
): ReduceResult {
  if (state.phase !== 'moveBlocker') return err('Nao e hora de mover o bloqueador.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  if (!state.board.hexes[hexId]) return err('Hex inexistente.');
  if (state.blocker.hexId === hexId) return err('O bloqueador precisa mudar de lugar.');

  // Ladrao amigavel: nao pode bloquear um hex que toca quem tem <3 PV (se houver
  // alternativa) nem roubar de quem tem <3 PV.
  if (state.friendlyRobber) {
    const anyAllowed = state.board.hexOrder.some(
      (h) => h !== state.blocker.hexId && robberAllowed(state, h, by),
    );
    if (anyAllowed && !robberAllowed(state, hexId, by)) {
      return err('Ladrão amigável: não pode bloquear quem tem menos de 3 pontos.');
    }
    if (stealFrom && stealFrom !== by && publicScoreOf(state, stealFrom) < 3) {
      return err('Ladrão amigável: não pode roubar de quem tem menos de 3 pontos.');
    }
  }

  const next = clone(state);
  next.blocker = { hexId };
  const events: GameEvent[] = [];

  if (stealFrom && stealFrom !== by) {
    // O alvo precisa ter construcao adjacente ao hex e cartas na mao.
    const hex = next.board.hexes[hexId]!;
    const touches = hex.corners.some((vid) => next.buildings[vid]?.owner === stealFrom);
    const victim = getPlayer(next, stealFrom);
    if (touches && handTotal(victim) > 0) {
      const pool: Resource[] = [];
      for (const res of RESOURCES) for (let i = 0; i < victim.hand[res]; i++) pool.push(res);
      const r = nextInt(next.rng, pool.length);
      next.rng = r.rng;
      const stolen = pool[r.value]!;
      victim.hand[stolen] -= 1;
      getPlayer(next, by).hand[stolen] += 1;
      events.push({ t: 'blockerMoved', hexId, stoleFrom: stealFrom, resource: stolen });
    } else {
      events.push({ t: 'blockerMoved', hexId });
    }
  } else {
    events.push({ t: 'blockerMoved', hexId });
  }

  next.phase = next.returnPhaseAfterBlocker ?? 'main';
  next.returnPhaseAfterBlocker = null;
  return ok(next, events);
}

// ---------------------------------------------------------------------------
// Construcao (fase principal)
// ---------------------------------------------------------------------------

function buildRoad(state: GameState, by: PlayerColor, edgeId: string): ReduceResult {
  if (state.phase !== 'main') return err('So da pra construir na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  const edge = state.board.edges[edgeId];
  if (!edge) return err('Aresta inexistente.');
  if (state.roads[edgeId]) return err('Aresta ja ocupada.');
  if (!roadConnects(state, by, edgeId)) return err('A estrada precisa conectar a algo seu.');

  const next = clone(state);
  const p = getPlayer(next, by);
  if (p.pieces.roads <= 0) return err('Sem estradas no estoque.');
  // Estradas gratis da carta "2 Estradas" tem prioridade sobre o pagamento.
  if (next.pendingFreeRoads > 0) {
    next.pendingFreeRoads -= 1;
  } else {
    if (!canAfford(p, COSTS.road)) return err('Recursos insuficientes para estrada.');
    payToBank(next, p, COSTS.road);
  }
  p.pieces.roads -= 1;
  next.roads[edgeId] = { owner: by, edgeId };

  const events: GameEvent[] = [{ t: 'built', kind: 'road', owner: by, id: edgeId }];
  updateLongestRoad(next, events);
  checkWin(next, by, events);
  return ok(next, events);
}

function buildSettlement(state: GameState, by: PlayerColor, vertexId: string): ReduceResult {
  if (state.phase !== 'main') return err('So da pra construir na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  if (!state.board.vertices[vertexId]) return err('Vertice inexistente.');
  if (!distanceRuleOk(state, vertexId)) return err('Vertice ocupado ou viola a regra de distancia.');
  if (!vertexTouchesPlayerRoad(state, by, vertexId)) return err('Precisa de uma estrada sua ate aqui.');

  const next = clone(state);
  const p = getPlayer(next, by);
  if (p.pieces.settlements <= 0) return err('Sem vilas no estoque.');
  if (!canAfford(p, COSTS.settlement)) return err('Recursos insuficientes para vila.');
  payToBank(next, p, COSTS.settlement);
  p.pieces.settlements -= 1;
  next.buildings[vertexId] = { kind: 'settlement', owner: by, vertexId };

  const events: GameEvent[] = [{ t: 'built', kind: 'settlement', owner: by, id: vertexId }];
  // Uma vila nova pode cortar a estrada mais longa de um adversario.
  updateLongestRoad(next, events);
  checkWin(next, by, events);
  return ok(next, events);
}

function buildCity(state: GameState, by: PlayerColor, vertexId: string): ReduceResult {
  if (state.phase !== 'main') return err('So da pra construir na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  const b = state.buildings[vertexId];
  if (!b || b.owner !== by) return err('Voce nao tem uma vila aqui.');
  if (b.kind !== 'settlement') return err('Aqui ja e uma cidade.');

  const next = clone(state);
  const p = getPlayer(next, by);
  if (p.pieces.cities <= 0) return err('Sem cidades no estoque.');
  if (!canAfford(p, COSTS.city)) return err('Recursos insuficientes para cidade.');
  payToBank(next, p, COSTS.city);
  p.pieces.cities -= 1;
  p.pieces.settlements += 1; // a vila volta ao estoque
  next.buildings[vertexId] = { kind: 'city', owner: by, vertexId };

  const events: GameEvent[] = [{ t: 'built', kind: 'city', owner: by, id: vertexId }];
  checkWin(next, by, events);
  return ok(next, events);
}

function buyProgressCard(state: GameState, by: PlayerColor): ReduceResult {
  if (state.phase !== 'main') return err('So da pra comprar na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  if (state.devDeck.length === 0) return err('O baralho de progresso acabou.');

  const next = clone(state);
  const p = getPlayer(next, by);
  if (!canAfford(p, COSTS.progressCard)) return err('Recursos insuficientes para carta.');
  payToBank(next, p, COSTS.progressCard);
  const card = next.devDeck.pop()!;
  p.progressCards.push(card);
  p.progressCardsBoughtThisTurn.push(card);

  const events: GameEvent[] = [{ t: 'progressCardBought', owner: by }];
  checkWin(next, by, events); // pode ser um ponto de vitoria
  return ok(next, events);
}

function tradeBank(
  state: GameState,
  by: PlayerColor,
  give: Resource,
  want: Resource,
): ReduceResult {
  if (state.phase !== 'main') return err('So da pra comerciar na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  if (give === want) return err('Recursos iguais.');

  const next = clone(state);
  const p = getPlayer(next, by);
  const rate = maritimeRate(next, by, give); // 4:1, ou 3:1/2:1 com porto
  if (p.hand[give] < rate) return err(`Precisa de ${rate} ${give}.`);
  if (next.bank[want] <= 0) return err('O banco nao tem esse recurso.');
  p.hand[give] -= rate;
  next.bank[give] += rate;
  p.hand[want] += 1;
  next.bank[want] -= 1;

  return ok(next, [{ t: 'bankTrade', owner: by, give, want, rate }]);
}

// ---------------------------------------------------------------------------
// Cartas de progresso
// ---------------------------------------------------------------------------

/** Verifica se o jogador pode jogar uma carta deste tipo agora. */
function cardPlayError(state: GameState, p: GameState['players'][number], card: ProgressCard): string | null {
  if (state.devCardPlayedThisTurn) return 'Voce ja jogou uma carta de progresso neste turno.';
  const have = p.progressCards.filter((c) => c === card).length;
  const bought = p.progressCardsBoughtThisTurn.filter((c) => c === card).length;
  if (have - bought <= 0) return 'Voce nao tem essa carta (ou foi comprada neste turno).';
  return null;
}

function removeCard(p: GameState['players'][number], card: ProgressCard): void {
  const i = p.progressCards.indexOf(card);
  if (i >= 0) p.progressCards.splice(i, 1);
}

function playKnight(state: GameState, by: PlayerColor): ReduceResult {
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  if (state.phase !== 'roll' && state.phase !== 'main') {
    return err('Cavaleiro so antes ou depois de rolar.');
  }
  const next = clone(state);
  const p = getPlayer(next, by);
  const e = cardPlayError(next, p, 'knight');
  if (e) return err(e);
  removeCard(p, 'knight');
  next.devCardPlayedThisTurn = true;
  p.knightsPlayed += 1;

  const events: GameEvent[] = [{ t: 'cardPlayed', owner: by, card: 'knight' }];
  updateLargestArmy(next, events);
  // Entra no fluxo de mover bloqueador, voltando a fase de onde veio.
  next.returnPhaseAfterBlocker = state.phase === 'roll' ? 'roll' : 'main';
  next.phase = 'moveBlocker';
  checkWin(next, by, events); // Maior Exercito pode fechar o jogo
  return ok(next, events);
}

function playRoadBuilding(state: GameState, by: PlayerColor): ReduceResult {
  if (state.phase !== 'main') return err('So da pra jogar na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  const next = clone(state);
  const p = getPlayer(next, by);
  const e = cardPlayError(next, p, 'roadBuilding');
  if (e) return err(e);
  removeCard(p, 'roadBuilding');
  next.devCardPlayedThisTurn = true;
  next.pendingFreeRoads += 2;
  return ok(next, [{ t: 'cardPlayed', owner: by, card: 'roadBuilding' }]);
}

function playYearOfPlenty(
  state: GameState,
  by: PlayerColor,
  resources: [Resource, Resource],
): ReduceResult {
  if (state.phase !== 'main') return err('So da pra jogar na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  const next = clone(state);
  const p = getPlayer(next, by);
  const e = cardPlayError(next, p, 'yearOfPlenty');
  if (e) return err(e);
  // O banco precisa ter os dois recursos pedidos.
  const need: Partial<Record<Resource, number>> = {};
  for (const r of resources) need[r] = (need[r] ?? 0) + 1;
  for (const [r, n] of Object.entries(need) as [Resource, number][]) {
    if (next.bank[r] < n) return err('O banco nao tem esses recursos.');
  }
  removeCard(p, 'yearOfPlenty');
  next.devCardPlayedThisTurn = true;
  const gains: Partial<Record<Resource, number>> = {};
  for (const r of resources) {
    p.hand[r] += 1;
    next.bank[r] -= 1;
    gains[r] = (gains[r] ?? 0) + 1;
  }
  const allGains = {} as Record<PlayerColor, Partial<Record<Resource, number>>>;
  for (const pl of next.players) allGains[pl.color] = pl.color === by ? gains : {};
  return ok(next, [
    { t: 'cardPlayed', owner: by, card: 'yearOfPlenty' },
    { t: 'produced', gains: allGains },
  ]);
}

function playMonopoly(state: GameState, by: PlayerColor, resource: Resource): ReduceResult {
  if (state.phase !== 'main') return err('So da pra jogar na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  const next = clone(state);
  const p = getPlayer(next, by);
  const e = cardPlayError(next, p, 'monopoly');
  if (e) return err(e);
  removeCard(p, 'monopoly');
  next.devCardPlayedThisTurn = true;
  let taken = 0;
  for (const other of next.players) {
    if (other.color === by) continue;
    taken += other.hand[resource];
    other.hand[resource] = 0;
  }
  p.hand[resource] += taken;
  return ok(next, [
    { t: 'cardPlayed', owner: by, card: 'monopoly' },
    { t: 'monopoly', owner: by, resource, taken },
  ]);
}

// ---------------------------------------------------------------------------
// Comercio entre jogadores
// ---------------------------------------------------------------------------

function sanitizeResMap(m: Partial<Record<Resource, number>>): Partial<Record<Resource, number>> {
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) {
    const n = m[r] ?? 0;
    if (n > 0 && Number.isInteger(n)) out[r] = n;
  }
  return out;
}

function moveResources(
  from: GameState['players'][number],
  to: GameState['players'][number],
  res: Partial<Record<Resource, number>>,
): void {
  for (const [r, n] of Object.entries(res) as [Resource, number][]) {
    from.hand[r] -= n;
    to.hand[r] += n;
  }
}

function proposeTrade(
  state: GameState,
  by: PlayerColor,
  give: Partial<Record<Resource, number>>,
  want: Partial<Record<Resource, number>>,
  to?: PlayerColor[],
): ReduceResult {
  if (state.phase !== 'main') return err('So da pra comerciar na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  const g = sanitizeResMap(give);
  const w = sanitizeResMap(want);
  if (Object.keys(g).length === 0 || Object.keys(w).length === 0) {
    return err('A troca precisa de recursos dos dois lados.');
  }
  const next = clone(state);
  const p = getPlayer(next, by);
  if (!canAfford(p, g)) return err('Voce nao tem os recursos oferecidos.');
  const recipients = (to ?? next.players.map((pl) => pl.color)).filter((c) => c !== by);
  if (recipients.length === 0) return err('Sem destinatarios.');
  next.activeTrade = { from: by, give: g, want: w, to: recipients, accepted: [] };
  next.tradeOffersThisTurn += 1;
  return ok(next, [{ t: 'tradeProposed', from: by }]);
}

/**
 * Contraproposta: um destinatario da oferta ativa devolve uma nova oferta ao
 * proponente original (so para ele). Nao precisa ser a vez de quem contrapropoe.
 */
function counterTrade(
  state: GameState,
  by: PlayerColor,
  give: Partial<Record<Resource, number>>,
  want: Partial<Record<Resource, number>>,
): ReduceResult {
  const trade = state.activeTrade;
  if (!trade) return err('Nao ha proposta para contrapor.');
  if (!trade.to.includes(by)) return err('Voce nao foi convidado a essa troca.');
  const g = sanitizeResMap(give);
  const w = sanitizeResMap(want);
  if (Object.keys(g).length === 0 || Object.keys(w).length === 0) return err('A troca precisa de recursos dos dois lados.');
  const next = clone(state);
  const p = getPlayer(next, by);
  if (!canAfford(p, g)) return err('Voce nao tem os recursos oferecidos.');
  next.activeTrade = { from: by, give: g, want: w, to: [trade.from], accepted: [] };
  return ok(next, [{ t: 'tradeCountered', from: by }]);
}

function respondTrade(state: GameState, by: PlayerColor, accept: boolean): ReduceResult {
  const trade = state.activeTrade;
  if (!trade) return err('Nao ha proposta ativa.');
  if (by === trade.from) return err('O proponente nao responde.');
  if (!trade.to.includes(by)) return err('Voce nao foi convidado.');
  const next = clone(state);
  const t = next.activeTrade!;
  if (accept) {
    const responder = getPlayer(next, by);
    if (!canAfford(responder, t.want)) return err('Voce nao tem o que foi pedido.');
    if (!t.accepted.includes(by)) t.accepted.push(by);
  } else {
    t.accepted = t.accepted.filter((c) => c !== by);
  }
  return ok(next, [{ t: 'tradeResponded', player: by, accept }]);
}

function confirmTrade(state: GameState, by: PlayerColor, withPlayer: PlayerColor): ReduceResult {
  const trade = state.activeTrade;
  if (!trade) return err('Nao ha proposta ativa.');
  if (by !== trade.from) return err('Apenas o proponente fecha o negocio.');
  if (!trade.accepted.includes(withPlayer)) return err('Esse jogador nao aceitou.');
  const next = clone(state);
  const from = getPlayer(next, by);
  const to = getPlayer(next, withPlayer);
  if (!canAfford(from, trade.give)) return err('Voce nao tem mais os recursos.');
  if (!canAfford(to, trade.want)) return err('O outro jogador nao tem mais os recursos.');
  moveResources(from, to, trade.give);
  moveResources(to, from, trade.want);
  next.activeTrade = null;
  return ok(next, [{ t: 'tradeExecuted', from: by, with: withPlayer }]);
}

function cancelTrade(state: GameState, by: PlayerColor): ReduceResult {
  const trade = state.activeTrade;
  if (!trade) return err('Nao ha proposta ativa.');
  if (by !== trade.from && by !== state.currentPlayer) return err('Nao pode cancelar.');
  const next = clone(state);
  next.activeTrade = null;
  return ok(next, [{ t: 'tradeCancelled' }]);
}

function endTurn(state: GameState, by: PlayerColor): ReduceResult {
  if (state.phase !== 'main') return err('So da pra encerrar na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');

  const next = clone(state);
  next.dice = null;
  next.devCardPlayedThisTurn = false;
  next.pendingFreeRoads = 0;
  next.activeTrade = null;
  next.tradeOffersThisTurn = 0;
  for (const p of next.players) p.progressCardsBoughtThisTurn = [];

  const idx = next.players.findIndex((p) => p.color === by);
  const nextColor = next.players[(idx + 1) % next.players.length]!.color;
  next.currentPlayer = nextColor;
  next.phase = 'roll';

  return ok(next, [{ t: 'turnEnded', next: nextColor }]);
}

// ---------------------------------------------------------------------------
// Bonus e vitoria
// ---------------------------------------------------------------------------

function updateLongestRoad(state: GameState, events: GameEvent[]): void {
  const lengths = new Map<PlayerColor, number>();
  for (const p of state.players) lengths.set(p.color, longestRoadLength(state, p.color));
  const maxLen = Math.max(...lengths.values());
  const leaders = [...lengths.entries()].filter(([, l]) => l === maxLen).map(([c]) => c);

  let owner = state.longestRoad.owner;
  if (maxLen < LONGEST_ROAD_MIN) {
    owner = null;
  } else if (owner && leaders.includes(owner)) {
    // mantem
  } else if (leaders.length === 1) {
    owner = leaders[0]!;
  } else if (!(owner && (lengths.get(owner) ?? 0) >= LONGEST_ROAD_MIN)) {
    owner = null;
  }

  if (owner !== state.longestRoad.owner) {
    state.longestRoad = { owner, length: owner ? (lengths.get(owner) ?? 0) : 0 };
    events.push({ t: 'longestRoad', owner });
  } else {
    state.longestRoad = { owner, length: owner ? (lengths.get(owner) ?? 0) : maxLen };
  }
}

export function updateLargestArmy(state: GameState, events: GameEvent[]): void {
  const sizes = new Map<PlayerColor, number>();
  for (const p of state.players) sizes.set(p.color, p.knightsPlayed);
  const maxSize = Math.max(...sizes.values());
  const leaders = [...sizes.entries()].filter(([, s]) => s === maxSize).map(([c]) => c);

  let owner = state.largestArmy.owner;
  if (maxSize < LARGEST_ARMY_MIN) {
    owner = null;
  } else if (owner && leaders.includes(owner)) {
    // mantem
  } else if (leaders.length === 1) {
    owner = leaders[0]!;
  } else if (!(owner && (sizes.get(owner) ?? 0) >= LARGEST_ARMY_MIN)) {
    owner = null;
  }

  if (owner !== state.largestArmy.owner) {
    state.largestArmy = { owner, size: owner ? (sizes.get(owner) ?? 0) : 0 };
    events.push({ t: 'largestArmy', owner });
  } else {
    state.largestArmy = { owner, size: owner ? (sizes.get(owner) ?? 0) : maxSize };
  }
}

function checkWin(state: GameState, by: PlayerColor, events: GameEvent[]): void {
  if (scoreOf(state, by) >= state.victoryTarget) {
    state.winner = by;
    state.phase = 'ended';
    events.push({ t: 'gameWon', winner: by });
  }
}

// ---------------------------------------------------------------------------
// Utilitarios locais
// ---------------------------------------------------------------------------

function resourceOf(terrain: GameState['board']['hexes'][string]['terrain']): Resource | null {
  switch (terrain) {
    case 'forest':
      return 'wood';
    case 'hills':
      return 'brick';
    case 'pasture':
      return 'wool';
    case 'field':
      return 'grain';
    case 'mountain':
      return 'ore';
    default:
      return null;
  }
}

