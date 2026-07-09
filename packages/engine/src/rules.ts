import {
  RESOURCES,
  type GameState,
  type Player,
  type PlayerColor,
  type Resource,
} from './types.js';

/** Custos de construcao (recursos). */
export const COSTS = {
  road: { wood: 1, brick: 1 } as Partial<Record<Resource, number>>,
  settlement: { wood: 1, brick: 1, wool: 1, grain: 1 } as Partial<Record<Resource, number>>,
  city: { grain: 2, ore: 3 } as Partial<Record<Resource, number>>,
  progressCard: { wool: 1, grain: 1, ore: 1 } as Partial<Record<Resource, number>>,
} as const;

export const VICTORY_POINTS_TO_WIN = 10;
export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;

export function getPlayer(state: GameState, color: PlayerColor): Player {
  const p = state.players.find((pl) => pl.color === color);
  if (!p) throw new Error(`Jogador inexistente: ${color}`);
  return p;
}

export function handTotal(p: Player): number {
  return RESOURCES.reduce((s, r) => s + p.hand[r], 0);
}

export function canAfford(p: Player, cost: Partial<Record<Resource, number>>): boolean {
  return (Object.entries(cost) as [Resource, number][]).every(([r, n]) => p.hand[r] >= n);
}

/** Paga o custo (mao -> banco). Assume canAfford ja verificado. */
export function payToBank(
  state: GameState,
  p: Player,
  cost: Partial<Record<Resource, number>>,
): void {
  for (const [r, n] of Object.entries(cost) as [Resource, number][]) {
    p.hand[r] -= n;
    state.bank[r] += n;
  }
}

/**
 * Melhor taxa de comercio maritimo do jogador para um recurso:
 * 4:1 por padrao, 3:1 com porto generico, 2:1 com porto daquele recurso.
 */
export function maritimeRate(state: GameState, color: PlayerColor, give: Resource): number {
  let rate = 4;
  for (const port of state.board.ports) {
    const owns = port.vertices.some((v) => state.buildings[v]?.owner === color);
    if (!owns) continue;
    if (port.type === 'generic') rate = Math.min(rate, 3);
    else if (port.type === give) rate = Math.min(rate, 2);
  }
  return rate;
}

/** Pontuacao total (inclui os pontos ocultos de cartas +1 PV). Usada na vitoria. */
export function scoreOf(state: GameState, color: PlayerColor): number {
  const p = getPlayer(state, color);
  return publicScoreOf(state, color) + p.progressCards.filter((c) => c === 'victoryPoint').length;
}

/**
 * Pontuacao *publica* (visivel no placar): NAO conta as cartas +1 PV, que sao
 * secretas. So sao reveladas quando o jogador realmente vence.
 */
export function publicScoreOf(state: GameState, color: PlayerColor): number {
  let pts = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.owner === color) pts += b.kind === 'city' ? 2 : 1;
  }
  if (state.longestRoad.owner === color) pts += 2;
  if (state.largestArmy.owner === color) pts += 2;
  return pts;
}

/**
 * Sob o LADRAO AMIGAVEL, um hex so e alvo valido se NAO toca construcao de um
 * adversario com menos de 3 PV publicos (cartas +1PV nao contam). Sem a regra
 * ligada, qualquer hex vale. `by` move o bloqueador (a si mesmo nunca conta).
 * O DESERTO e sempre permitido: nao produz nada, entao bloquea-lo nunca prejudica
 * ninguem (e o destino "inofensivo" classico para o ladrao).
 */
export function robberAllowed(state: GameState, hexId: string, by: PlayerColor): boolean {
  if (!state.friendlyRobber) return true;
  const hex = state.board.hexes[hexId];
  if (!hex) return false;
  if (hex.terrain === 'desert') return true;
  return !hex.corners.some((vid) => {
    const b = state.buildings[vid];
    return b && b.owner !== by && publicScoreOf(state, b.owner) < 3;
  });
}

/**
 * Quantas cartas o jogador tem na mao, respeitando o fog of war. No estado
 * autoritativo (servidor) `hiddenHand` e undefined e conta-se a mao real; num
 * estado projetado a mao do adversario vem zerada e o total fica em `hiddenHand`.
 * Assim a mesma funcao da o valor certo tanto no servidor quanto no cliente.
 */
export function handSize(p: Player): number {
  return p.hiddenHand ?? handTotal(p);
}

/**
 * Adversarios de quem `by` pode roubar ao mover o bloqueador para `hexId`: os que
 * tem construcao adjacente ao hex e ao menos uma carta na mao (e, sob o ladrao
 * amigavel, >= 3 PV publicos). O proprio `by` nunca e alvo. Fonte UNICA da regra:
 * o servidor decide o roubo com ela (autoridade), o cliente so a usa para saber
 * se precisa perguntar de quem roubar (quando ha 2+ alvos).
 */
export function robberVictims(state: GameState, hexId: string, by: PlayerColor): PlayerColor[] {
  const hex = state.board.hexes[hexId];
  if (!hex) return [];
  const victims = new Set<PlayerColor>();
  for (const vid of hex.corners) {
    const b = state.buildings[vid];
    if (!b || b.owner === by) continue;
    if (state.friendlyRobber && publicScoreOf(state, b.owner) < 3) continue;
    if (handSize(getPlayer(state, b.owner)) <= 0) continue;
    victims.add(b.owner);
  }
  return [...victims];
}

/** Regra de distancia: o vertice e seus vizinhos imediatos devem estar livres. */
export function distanceRuleOk(state: GameState, vertexId: string): boolean {
  if (state.buildings[vertexId]) return false;
  const v = state.board.vertices[vertexId];
  if (!v) return false;
  return v.adj.every((nb) => !state.buildings[nb]);
}

function buildingOwnerAt(state: GameState, vertexId: string): PlayerColor | null {
  return state.buildings[vertexId]?.owner ?? null;
}

/** O vertice toca uma estrada do jogador (para construir vila na fase principal). */
export function vertexTouchesPlayerRoad(
  state: GameState,
  color: PlayerColor,
  vertexId: string,
): boolean {
  const v = state.board.vertices[vertexId];
  if (!v) return false;
  return v.edges.some((eid) => state.roads[eid]?.owner === color);
}

/**
 * Uma aresta pode receber estrada do jogador se, em um de seus extremos, ha
 * uma construcao propria OU uma estrada propria — e esse extremo nao esta
 * ocupado por construcao de adversario (que bloqueia a continuidade).
 */
export function roadConnects(state: GameState, color: PlayerColor, edgeId: string): boolean {
  const e = state.board.edges[edgeId];
  if (!e) return false;
  for (const vid of e.v) {
    const owner = buildingOwnerAt(state, vid);
    if (owner && owner !== color) continue; // extremo bloqueado por adversario
    if (owner === color) return true; // construcao propria no extremo
    const v = state.board.vertices[vid]!;
    if (v.edges.some((other) => other !== edgeId && state.roads[other]?.owner === color)) {
      return true;
    }
  }
  return false;
}

/**
 * Producao para uma soma de dados: retorna os ganhos por jogador, ja aplicando
 * a escassez do banco (se faltam recursos e mais de um jogador disputa, ninguem
 * recebe; se so um disputa, recebe o que houver).
 */
export function computeProduction(
  state: GameState,
  sum: number,
): Record<PlayerColor, Partial<Record<Resource, number>>> {
  // demanda[resource] = lista de {color, amount}
  const demand: Record<Resource, { color: PlayerColor; amount: number }[]> = {
    wood: [],
    brick: [],
    wool: [],
    grain: [],
    ore: [],
  };

  for (const hid of state.board.hexOrder) {
    const hex = state.board.hexes[hid]!;
    if (hex.number !== sum) continue;
    if (state.blocker.hexId === hid) continue;
    const res = terrainResource(hex.terrain);
    if (!res) continue;
    for (const vid of hex.corners) {
      const b = state.buildings[vid];
      if (!b) continue;
      const amount = b.kind === 'city' ? 2 : 1;
      demand[res].push({ color: b.owner, amount });
    }
  }

  const gains = {} as Record<PlayerColor, Partial<Record<Resource, number>>>;
  for (const p of state.players) gains[p.color] = {};

  for (const res of RESOURCES) {
    const reqs = demand[res];
    if (reqs.length === 0) continue;
    const total = reqs.reduce((s, d) => s + d.amount, 0);
    const distinctPlayers = new Set(reqs.map((d) => d.color)).size;
    if (total <= state.bank[res]) {
      for (const d of reqs) gains[d.color][res] = (gains[d.color][res] ?? 0) + d.amount;
    } else if (distinctPlayers === 1) {
      const only = reqs[0]!.color;
      gains[only][res] = (gains[only][res] ?? 0) + state.bank[res];
    }
    // senao: escassez disputada -> ninguem recebe esse recurso.
  }
  return gains;
}

function terrainResource(terrain: GameState['board']['hexes'][string]['terrain']): Resource | null {
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

/**
 * Maior trilha (sem repetir arestas) de estradas do jogador, respeitando o
 * bloqueio por construcoes de adversarios nos vertices intermediarios.
 */
export function longestRoadLength(state: GameState, color: PlayerColor): number {
  const playerEdges = Object.values(state.roads).filter((r) => r.owner === color);
  if (playerEdges.length === 0) return 0;

  // adjacencia: vertice -> [{edgeId, other}]
  const adj = new Map<string, { edgeId: string; other: string }[]>();
  for (const road of playerEdges) {
    const e = state.board.edges[road.edgeId]!;
    const [a, b] = e.v;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ edgeId: road.edgeId, other: b });
    adj.get(b)!.push({ edgeId: road.edgeId, other: a });
  }

  const blockedAt = (vid: string): boolean => {
    const owner = state.buildings[vid]?.owner;
    return owner !== undefined && owner !== color;
  };

  let best = 0;
  const used = new Set<string>();

  const dfs = (vid: string, lengthSoFar: number): void => {
    if (lengthSoFar > best) best = lengthSoFar;
    if (blockedAt(vid)) return; // nao continua atraves de construcao adversaria
    for (const { edgeId, other } of adj.get(vid) ?? []) {
      if (used.has(edgeId)) continue;
      used.add(edgeId);
      dfs(other, lengthSoFar + 1);
      used.delete(edgeId);
    }
  };

  for (const start of adj.keys()) dfs(start, 0);
  return best;
}
