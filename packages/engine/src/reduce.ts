import { nextInt, rollDie, shuffle } from './rng.js';
import { allDiceCombos } from './setup.js';
import {
  COSTS,
  LARGEST_ARMY_MIN,
  LONGEST_ROAD_MIN,
  canAfford,
  computeGoldPending,
  computeProduction,
  distanceRuleOk,
  edgeTouchesLand,
  getPlayer,
  handTotal,
  islandsAtVertex,
  isSeaEdge,
  isSeaGame,
  isSeaHex,
  longestNetworkLength,
  maritimeRate,
  payToBank,
  pirateVictims,
  publicScoreOf,
  roadConnects,
  robberAllowed,
  robberVictims,
  scoreOf,
  shipConnects,
  vertexTouchesMainIsland,
  vertexTouchesPlayerNetwork,
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
    case 'buildShip':
      return buildShip(state, by, action.edgeId);
    case 'moveShip':
      return moveShip(state, by, action.from, action.to);
    case 'chooseGoldResource':
      return chooseGoldResource(state, by, action.resources);
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
      return proposeTrade(state, by, action.give, action.want, action.to, action.wantAny);
    case 'counterTrade':
      return counterTrade(state, by, action.give, action.want);
    case 'respondTrade':
      return respondTrade(state, by, action.accept, action.resolveAny);
    case 'confirmTrade':
      return confirmTrade(state, by, action.with);
    case 'cancelTrade':
      return cancelTrade(state, by);
    case 'setEmbargo':
      return setEmbargo(state, by, action.target, action.on);
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
  // Navegadores: as colocacoes iniciais ficam restritas a ilha principal.
  if (isSeaGame(state) && !vertexTouchesMainIsland(state, vertexId)) {
    return err('No inicio, so da pra construir na ilha principal.');
  }

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
  // Navegadores: a estrada inicial fica em terra (a vila inicial é na ilha principal).
  if (isSeaGame(state) && !edgeTouchesLand(state, edgeId)) return err('A estrada inicial precisa tocar terra.');
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
  let dice: [number, number];
  if (next.balancedDice) {
    // Dados balanceados: puxa a proxima combinacao do saco; reabastece+embaralha
    // ao esvaziar (mantem a distribuicao teorica a cada ciclo de 36 rolagens).
    if (!next.diceBag || next.diceBag.length === 0) {
      const b = shuffle(next.rng, allDiceCombos());
      next.rng = b.rng;
      next.diceBag = b.value;
    }
    dice = next.diceBag.pop()!;
  } else {
    const d1 = rollDie(next.rng);
    const d2 = rollDie(d1.rng);
    next.rng = d2.rng;
    dice = [d1.value, d2.value];
  }
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

  // Navegadores: hexes de OURO rendem recursos a ESCOLHER — antes de seguir para
  // 'main', quem tem construcao adjacente a um ouro que saiu escolhe os recursos.
  if (isSeaGame(next)) {
    const goldPending = computeGoldPending(next, sum);
    if (Object.keys(goldPending).length > 0) {
      next.pendingGold = goldPending;
      next.phase = 'chooseGold';
      return ok(next, events);
    }
  }

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
  // Navegadores: um hex de MAR move o PIRATA; um hex de TERRA move o LADRAO.
  if (isSeaGame(state) && isSeaHex(state, hexId)) return movePirate(state, by, hexId, stealFrom);
  if (state.blocker.hexId === hexId) return err('O bloqueador precisa mudar de lugar.');

  // Ladrao amigavel: nao pode bloquear um hex que toca quem tem <3 PV se houver
  // alternativa. (A protecao ao roubo de quem tem <3 PV ja vem em robberVictims.)
  if (state.friendlyRobber) {
    const anyAllowed = state.board.hexOrder.some(
      (h) => h !== state.blocker.hexId && robberAllowed(state, h, by),
    );
    if (anyAllowed && !robberAllowed(state, hexId, by)) {
      return err('Ladrão amigável: não pode bloquear quem tem menos de 3 pontos.');
    }
  }

  // O SERVIDOR e a autoridade sobre o roubo: as vitimas elegiveis saem do estado
  // completo, nao de um flag do cliente. `stealFrom` do cliente so serve para
  // DESAMBIGUAR quando ha 2+ alvos; com um unico alvo, rouba-se automaticamente.
  const victims = robberVictims(state, hexId, by);
  let target: PlayerColor | undefined;
  if (victims.length === 1) {
    target = victims[0];
  } else if (victims.length >= 2) {
    if (!stealFrom || !victims.includes(stealFrom)) {
      return err('Escolha de quem roubar.');
    }
    target = stealFrom;
  }
  // victims.length === 0 -> hex sem alvo valido: move o bloqueador sem roubar.

  const next = clone(state);
  next.blocker = { hexId };
  const events: GameEvent[] = [];

  if (target) {
    const victim = getPlayer(next, target);
    const pool: Resource[] = [];
    for (const res of RESOURCES) for (let i = 0; i < victim.hand[res]; i++) pool.push(res);
    const r = nextInt(next.rng, pool.length);
    next.rng = r.rng;
    const stolen = pool[r.value]!;
    victim.hand[stolen] -= 1;
    getPlayer(next, by).hand[stolen] += 1;
    events.push({ t: 'blockerMoved', hexId, by, stoleFrom: target, resource: stolen });
  } else {
    events.push({ t: 'blockerMoved', hexId, by });
  }

  next.phase = next.returnPhaseAfterBlocker ?? 'main';
  next.returnPhaseAfterBlocker = null;
  return ok(next, events);
}

/**
 * Navegadores: move o PIRATA para um hex de mar e rouba de quem tem navio vizinho.
 * Autoridade no servidor (as vitimas saem de `pirateVictims`); `stealFrom` so
 * desambigua com 2+ alvos. Compartilha o fluxo de retorno de fase de `moveBlocker`.
 */
function movePirate(state: GameState, by: PlayerColor, hexId: string, stealFrom?: PlayerColor): ReduceResult {
  if (state.pirate?.hexId === hexId) return err('O pirata precisa mudar de lugar.');

  const victims = pirateVictims(state, hexId, by);
  let target: PlayerColor | undefined;
  if (victims.length === 1) {
    target = victims[0];
  } else if (victims.length >= 2) {
    if (!stealFrom || !victims.includes(stealFrom)) return err('Escolha de quem roubar.');
    target = stealFrom;
  }

  const next = clone(state);
  next.pirate = { hexId };
  const events: GameEvent[] = [];
  if (target) {
    const resource = stealRandomResource(next, by, target);
    events.push({ t: 'pirateMoved', hexId, by, stoleFrom: target, resource });
  } else {
    events.push({ t: 'pirateMoved', hexId, by });
  }

  next.phase = next.returnPhaseAfterBlocker ?? 'main';
  next.returnPhaseAfterBlocker = null;
  return ok(next, events);
}

/** Rouba uma carta aleatoria de `from` para `by` (usa o PRNG do estado). */
function stealRandomResource(next: GameState, by: PlayerColor, from: PlayerColor): Resource {
  const victim = getPlayer(next, from);
  const pool: Resource[] = [];
  for (const res of RESOURCES) for (let i = 0; i < victim.hand[res]; i++) pool.push(res);
  const r = nextInt(next.rng, pool.length);
  next.rng = r.rng;
  const stolen = pool[r.value]!;
  victim.hand[stolen] -= 1;
  getPlayer(next, by).hand[stolen] += 1;
  return stolen;
}

// ---------------------------------------------------------------------------
// Construcao (fase principal)
// ---------------------------------------------------------------------------

function buildRoad(state: GameState, by: PlayerColor, edgeId: string): ReduceResult {
  if (state.phase !== 'main') return err('So da pra construir na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  const edge = state.board.edges[edgeId];
  if (!edge) return err('Aresta inexistente.');
  if (state.roads[edgeId] || state.ships?.[edgeId]) return err('Aresta ja ocupada.');
  // Navegadores: estrada so em aresta que toca terra (o mar e para navios).
  if (isSeaGame(state) && !edgeTouchesLand(state, edgeId)) return err('Estrada so em terra; use um navio no mar.');
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
  if (!vertexTouchesPlayerNetwork(state, by, vertexId)) return err('Precisa de uma estrada ou navio seu ate aqui.');

  const next = clone(state);
  const p = getPlayer(next, by);
  if (p.pieces.settlements <= 0) return err('Sem vilas no estoque.');
  if (!canAfford(p, COSTS.settlement)) return err('Recursos insuficientes para vila.');
  payToBank(next, p, COSTS.settlement);
  p.pieces.settlements -= 1;
  next.buildings[vertexId] = { kind: 'settlement', owner: by, vertexId };

  const events: GameEvent[] = [{ t: 'built', kind: 'settlement', owner: by, id: vertexId }];
  // Navegadores: colonizar uma ilha nova rende VP de ilha.
  awardIslandVP(next, by, vertexId, events);
  // Uma vila nova pode cortar a estrada mais longa de um adversario.
  updateLongestRoad(next, events);
  checkWin(next, by, events);
  return ok(next, events);
}

/**
 * Navegadores: se `vertexId` toca uma ilha MENOR que `by` ainda nao colonizou,
 * registra-a e concede `islandBonus` PV (evento islandSettled).
 */
function awardIslandVP(state: GameState, by: PlayerColor, vertexId: string, events: GameEvent[]): void {
  if (!state.islandBonus) return;
  const p = getPlayer(state, by);
  if (!p.islandsScored) p.islandsScored = [];
  for (const isl of islandsAtVertex(state, vertexId)) {
    if (p.islandsScored.includes(isl)) continue;
    p.islandsScored.push(isl);
    events.push({ t: 'islandSettled', owner: by, island: isl, bonus: state.islandBonus });
  }
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

// ---------------------------------------------------------------------------
// Navegadores: navios e escolha do ouro
// ---------------------------------------------------------------------------

function buildShip(state: GameState, by: PlayerColor, edgeId: string): ReduceResult {
  if (state.phase !== 'main') return err('So da pra construir na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  if (!isSeaGame(state)) return err('Navios so existem em Navegadores.');
  const edge = state.board.edges[edgeId];
  if (!edge) return err('Aresta inexistente.');
  if (state.roads[edgeId] || state.ships?.[edgeId]) return err('Aresta ja ocupada.');
  if (!isSeaEdge(state, edgeId)) return err('Navio so em aresta de mar.');
  if (state.pirate && edge.hexes.includes(state.pirate.hexId)) return err('O pirata bloqueia esse trecho de mar.');
  if (!shipConnects(state, by, edgeId)) return err('O navio precisa conectar a algo seu no mar.');

  const next = clone(state);
  const p = getPlayer(next, by);
  if ((p.pieces.ships ?? 0) <= 0) return err('Sem navios no estoque.');
  // Estradas gratis (carta "2 Estradas") tambem pagam navios em Navegadores.
  if (next.pendingFreeRoads > 0) {
    next.pendingFreeRoads -= 1;
  } else {
    if (!canAfford(p, COSTS.ship)) return err('Recursos insuficientes para navio.');
    payToBank(next, p, COSTS.ship);
  }
  p.pieces.ships = (p.pieces.ships ?? 0) - 1;
  if (!next.ships) next.ships = {};
  next.ships[edgeId] = { owner: by, edgeId };

  const events: GameEvent[] = [{ t: 'shipBuilt', owner: by, edgeId }];
  updateLongestRoad(next, events);
  checkWin(next, by, events);
  return ok(next, events);
}

/**
 * Mover um navio "aberto" (Navegadores). Adiado nesta versao: o nucleo de
 * Navegadores (construir navios, ilhas, ouro, pirata, Maior Rota) ja funciona sem
 * mover navios; a regra do "navio aberto" entra numa iteracao seguinte.
 */
function moveShip(_state: GameState, _by: PlayerColor, _from: string, _to: string): ReduceResult {
  return err('Mover navios ainda nao esta disponivel nesta versao.');
}

/**
 * Navegadores: um jogador com ouro pendente (fase 'chooseGold') escolhe QUAIS
 * recursos receber. Valida contra o que resta no banco (se o banco nao cobre tudo,
 * o pendente e limitado ao total disponivel — evita travar). Quando todos resolvem,
 * a vez volta para 'main'.
 */
function chooseGoldResource(
  state: GameState,
  by: PlayerColor,
  resources: Partial<Record<Resource, number>>,
): ReduceResult {
  if (state.phase !== 'chooseGold') return err('Nao e hora de escolher recursos do ouro.');
  const pendingRaw = state.pendingGold?.[by];
  if (!pendingRaw) return err('Voce nao tem ouro a resolver.');

  const bankTotal = RESOURCES.reduce((s, r) => s + state.bank[r], 0);
  const required = Math.min(pendingRaw, bankTotal);
  const clean = sanitizeResMap(resources);
  if (totalRes(clean) !== required) return err(`Escolha exatamente ${required} recurso(s) do ouro.`);
  for (const [r, n] of Object.entries(clean) as [Resource, number][]) {
    if (state.bank[r] < n) return err('O banco nao tem esses recursos.');
  }

  const next = clone(state);
  const p = getPlayer(next, by);
  for (const [r, n] of Object.entries(clean) as [Resource, number][]) {
    p.hand[r] += n;
    next.bank[r] -= n;
  }
  delete next.pendingGold![by];

  const events: GameEvent[] = [{ t: 'goldChosen', owner: by, resources: clean }];
  if (Object.keys(next.pendingGold ?? {}).length === 0) {
    next.phase = 'main';
  }
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

/** Total de cartas num mapa de recursos. */
function totalRes(m: Partial<Record<Resource, number>>): number {
  return (Object.values(m) as number[]).reduce((s, n) => s + (n ?? 0), 0);
}

/** Soma dois mapas de recursos num novo mapa. */
function mergeRes(
  a: Partial<Record<Resource, number>>,
  b: Partial<Record<Resource, number>>,
): Partial<Record<Resource, number>> {
  const out: Partial<Record<Resource, number>> = { ...a };
  for (const [r, n] of Object.entries(b) as [Resource, number][]) out[r] = (out[r] ?? 0) + (n ?? 0);
  return out;
}

/** Existe embargo comercial (em qualquer direção) entre `a` e `b`? */
export function embargoed(state: GameState, a: PlayerColor, b: PlayerColor): boolean {
  return (state.embargoes ?? []).some(
    (e) => (e.by === a && e.target === b) || (e.by === b && e.target === a),
  );
}

/** Liga/desliga o embargo de `by` sobre `target` (recusa comerciar com ele). */
function setEmbargo(state: GameState, by: PlayerColor, target: PlayerColor, on: boolean): ReduceResult {
  if (target === by) return err('Nao da pra embargar a si mesmo.');
  if (!state.players.some((p) => p.color === target)) return err('Jogador inexistente.');
  const next = clone(state);
  const list = (next.embargoes ?? []).filter((e) => !(e.by === by && e.target === target));
  if (on) list.push({ by, target });
  next.embargoes = list;
  return ok(next, [{ t: 'embargo', by, target, on }]);
}

function proposeTrade(
  state: GameState,
  by: PlayerColor,
  give: Partial<Record<Resource, number>>,
  want: Partial<Record<Resource, number>>,
  to?: PlayerColor[],
  wantAny?: number,
): ReduceResult {
  if (state.phase !== 'main') return err('So da pra comerciar na fase principal.');
  if (by !== state.currentPlayer) return err('Nao e a sua vez.');
  const g = sanitizeResMap(give);
  const w = sanitizeResMap(want);
  const any = Number.isInteger(wantAny) && (wantAny ?? 0) > 0 ? wantAny! : 0;
  if (Object.keys(g).length === 0 || (Object.keys(w).length === 0 && any === 0)) {
    return err('A troca precisa de recursos dos dois lados.');
  }
  const next = clone(state);
  const p = getPlayer(next, by);
  if (!canAfford(p, g)) return err('Voce nao tem os recursos oferecidos.');
  // Destinatarios: exclui a si mesmo e quem esta em embargo (qualquer direcao).
  const recipients = (to ?? next.players.map((pl) => pl.color)).filter(
    (c) => c !== by && !embargoed(next, by, c),
  );
  if (recipients.length === 0) return err('Sem destinatarios (embargo?).');
  next.activeTrade = { from: by, give: g, want: w, wantAny: any || undefined, to: recipients, accepted: [] };
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
  if (embargoed(state, by, trade.from)) return err('Ha um embargo com esse jogador.');
  const next = clone(state);
  const p = getPlayer(next, by);
  if (!canAfford(p, g)) return err('Voce nao tem os recursos oferecidos.');
  next.activeTrade = { from: by, give: g, want: w, to: [trade.from], accepted: [] };
  return ok(next, [{ t: 'tradeCountered', from: by }]);
}

function respondTrade(
  state: GameState,
  by: PlayerColor,
  accept: boolean,
  resolveAny?: Partial<Record<Resource, number>>,
): ReduceResult {
  const trade = state.activeTrade;
  if (!trade) return err('Nao ha proposta ativa.');
  if (by === trade.from) return err('O proponente nao responde.');
  if (!trade.to.includes(by)) return err('Voce nao foi convidado.');
  const next = clone(state);
  const t = next.activeTrade!;
  if (accept) {
    const responder = getPlayer(next, by);
    // Carta CORINGA: o aceitante escolhe quais recursos dar pelo `wantAny`.
    let wantTotal = t.want;
    if (t.wantAny && t.wantAny > 0) {
      const resolve = sanitizeResMap(resolveAny ?? {});
      if (totalRes(resolve) !== t.wantAny) return err(`Escolha ${t.wantAny} recurso(s) para o coringa.`);
      wantTotal = mergeRes(t.want, resolve);
      t.resolutions = { ...(t.resolutions ?? {}), [by]: resolve };
    }
    if (!canAfford(responder, wantTotal)) return err('Voce nao tem o que foi pedido.');
    if (!t.accepted.includes(by)) t.accepted.push(by);
  } else {
    t.accepted = t.accepted.filter((c) => c !== by);
    if (t.resolutions) delete t.resolutions[by];
  }
  return ok(next, [{ t: 'tradeResponded', player: by, accept }]);
}

function confirmTrade(state: GameState, by: PlayerColor, withPlayer: PlayerColor): ReduceResult {
  const trade = state.activeTrade;
  if (!trade) return err('Nao ha proposta ativa.');
  if (by !== trade.from) return err('Apenas o proponente fecha o negocio.');
  if (embargoed(state, by, withPlayer)) return err('Ha um embargo com esse jogador.');
  if (!trade.accepted.includes(withPlayer)) return err('Esse jogador nao aceitou.');
  const next = clone(state);
  const t = next.activeTrade!;
  const from = getPlayer(next, by);
  const to = getPlayer(next, withPlayer);
  // Coringa: soma a resolucao escolhida por quem aceitou ao que foi pedido.
  const wantTotal = t.wantAny && t.wantAny > 0 ? mergeRes(t.want, t.resolutions?.[withPlayer] ?? {}) : t.want;
  if (!canAfford(from, t.give)) return err('Voce nao tem mais os recursos.');
  if (!canAfford(to, wantTotal)) return err('O outro jogador nao tem mais os recursos.');
  moveResources(from, to, t.give);
  moveResources(to, from, wantTotal);
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
  for (const p of state.players) lengths.set(p.color, longestNetworkLength(state, p.color));
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

