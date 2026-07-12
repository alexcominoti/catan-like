import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/setup.js';
import { reduce } from '../src/reduce.js';
import {
  computeGoldPending,
  distanceRuleOk,
  edgeTouchesLand,
  islandsAtVertex,
  isSeaEdge,
  longestRouteLength,
  publicScoreOf,
  vertexTouchesMainIsland,
} from '../src/rules.js';
import type { GameState, PlayerColor, Resource } from '../src/types.js';

function seaState(seed = 1): GameState {
  return createInitialState({ expansion: 'sea', seed, numberLayout: 'balanced' });
}

function give(s: GameState, color: PlayerColor, res: Partial<Record<Resource, number>>): void {
  const p = s.players.find((pl) => pl.color === color)!;
  for (const [r, n] of Object.entries(res) as [Resource, number][]) p.hand[r] += n;
}

describe('Navegadores — cenário "Novas Terras"', () => {
  it('monta mar + ilha principal (9) + 3 ilhas menores (2 cada), deserto no centro', () => {
    const s = seaState(3);
    expect(s.expansion).toBe('sea');
    expect(s.board.hexOrder).toHaveLength(37);

    const main = s.board.hexOrder.filter((h) => s.board.hexes[h]!.island === 0);
    expect(main).toHaveLength(9);
    for (const isl of [1, 2, 3]) {
      expect(s.board.hexOrder.filter((h) => s.board.hexes[h]!.island === isl)).toHaveLength(2);
    }
    const sea = s.board.hexOrder.filter((h) => s.board.hexes[h]!.terrain === 'sea');
    expect(sea).toHaveLength(37 - 9 - 6);

    const desert = s.board.hexes[s.blocker.hexId]!;
    expect(desert.terrain).toBe('desert');
    expect([desert.q, desert.r]).toEqual([0, 0]);

    // Pirata num hex de mar; navios/pecas/ilhas/ilhaBonus prontos.
    expect(s.pirate).toBeTruthy();
    expect(s.board.hexes[s.pirate!.hexId]!.terrain).toBe('sea');
    expect(s.players[0]!.pieces.ships).toBe(15);
    expect(s.players[0]!.islandsScored).toEqual([]);
    expect(s.islandBonus).toBe(2);
    expect(s.ships).toEqual({});
    expect(s.board.ports).toHaveLength(5);
    expect(s.board.hexOrder.filter((h) => s.board.hexes[h]!.terrain === 'gold')).toHaveLength(2);
  });

  it('é determinístico para a mesma seed', () => {
    const a = seaState(9);
    const b = seaState(9);
    const terr = (s: GameState) => s.board.hexOrder.map((h) => s.board.hexes[h]!.terrain);
    const nums = (s: GameState) => s.board.hexOrder.map((h) => s.board.hexes[h]!.number);
    expect(terr(a)).toEqual(terr(b));
    expect(nums(a)).toEqual(nums(b));
    expect(a.pirate).toEqual(b.pirate);
  });

  it('as colocações iniciais ficam restritas à ilha principal', () => {
    const s = seaState(4);
    const smallVid = s.board.vertexOrder.find(
      (v) => islandsAtVertex(s, v).length > 0 && !vertexTouchesMainIsland(s, v) && distanceRuleOk(s, v),
    )!;
    expect(smallVid).toBeTruthy();
    expect(reduce(s, s.currentPlayer, { t: 'placeSettlement', vertexId: smallVid }).ok).toBe(false);

    const mainVid = s.board.vertexOrder.find((v) => vertexTouchesMainIsland(s, v) && distanceRuleOk(s, v))!;
    expect(reduce(s, s.currentPlayer, { t: 'placeSettlement', vertexId: mainVid }).ok).toBe(true);
  });
});

describe('Navegadores — navios e rota', () => {
  it('estrada só toca terra; navio só toca mar', () => {
    const s = seaState(2);
    s.phase = 'main';
    s.pirate = null;

    const seaOnly = s.board.edgeOrder.find((e) => isSeaEdge(s, e) && !edgeTouchesLand(s, e))!;
    expect(seaOnly).toBeTruthy();
    give(s, s.currentPlayer, { wood: 1, brick: 1 });
    expect(reduce(s, s.currentPlayer, { t: 'buildRoad', edgeId: seaOnly }).ok).toBe(false);

    const seaEdge = s.board.edgeOrder.find((e) => isSeaEdge(s, e))!;
    const a = s.board.edges[seaEdge]!.v[0];
    s.buildings[a] = { kind: 'settlement', owner: s.currentPlayer, vertexId: a };
    give(s, s.currentPlayer, { wood: 1, wool: 1 });
    const r = reduce(s, s.currentPlayer, { t: 'buildShip', edgeId: seaEdge });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ships![seaEdge]?.owner).toBe(s.currentPlayer);
    expect(r.state.players.find((p) => p.color === s.currentPlayer)!.pieces.ships).toBe(14);
  });

  it('a Maior Rota conta navios e só cruza estrada↔navio numa construção própria', () => {
    const s = seaState(2);
    // Um vértice costeiro b com uma aresta de terra pura e uma de mar.
    let b = '';
    let landE = '';
    let seaE = '';
    for (const vid of s.board.vertexOrder) {
      const edges = s.board.vertices[vid]!.edges;
      const l = edges.find((e) => edgeTouchesLand(s, e) && !isSeaEdge(s, e));
      const m = edges.find((e) => isSeaEdge(s, e));
      if (l && m) {
        b = vid;
        landE = l;
        seaE = m;
        break;
      }
    }
    expect(b).toBeTruthy();
    s.roads[landE] = { owner: 'red', edgeId: landE };
    s.ships = { [seaE]: { owner: 'red', edgeId: seaE } };
    // Sem construção em b, a estrada e o navio não se conectam (rota = 1).
    expect(longestRouteLength(s, 'red')).toBe(1);
    // Com uma vila própria em b, a rota cruza (2).
    s.buildings[b] = { kind: 'settlement', owner: 'red', vertexId: b };
    expect(longestRouteLength(s, 'red')).toBe(2);
  });
});

describe('Navegadores — pirata, ouro e ilha', () => {
  it('mover o pirata (hex de mar) rouba de quem tem navio vizinho', () => {
    const s = seaState(7);
    s.phase = 'moveBlocker';
    s.currentPlayer = 'red';
    s.returnPhaseAfterBlocker = 'main';

    // Aresta de mar cujo hex de mar não é o do pirata atual.
    const seaEdge = s.board.edgeOrder.find((e) => {
      if (!isSeaEdge(s, e)) return false;
      const seaHex = s.board.edges[e]!.hexes.find((h) => s.board.hexes[h]!.terrain === 'sea');
      return seaHex && seaHex !== s.pirate?.hexId;
    })!;
    const target = s.board.edges[seaEdge]!.hexes.find((h) => s.board.hexes[h]!.terrain === 'sea')!;
    s.ships = { [seaEdge]: { owner: 'blue', edgeId: seaEdge } };
    give(s, 'blue', { ore: 1 });

    const r = reduce(s, 'red', { t: 'moveBlocker', hexId: target });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.pirate!.hexId).toBe(target);
    expect(r.state.players.find((p) => p.color === 'blue')!.hand.ore).toBe(0);
    expect(r.state.players.find((p) => p.color === 'red')!.hand.ore).toBe(1);
    expect(r.state.phase).toBe('main');
  });

  it('hex de ouro entra na fase de escolha e credita o recurso escolhido', () => {
    const s = seaState(1);
    s.phase = 'roll';
    s.currentPlayer = 'red';
    s.balancedDice = true;
    const goldHex = s.board.hexOrder.find((h) => s.board.hexes[h]!.terrain === 'gold')!;
    s.board.hexes[goldHex]!.number = 5;
    const vid = s.board.hexes[goldHex]!.corners[0]!;
    s.buildings[vid] = { kind: 'settlement', owner: 'red', vertexId: vid };
    expect(computeGoldPending(s, 5)).toEqual({ red: 1 });

    s.diceBag = [[2, 3]]; // soma 5
    const r = reduce(s, 'red', { t: 'rollDice' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('chooseGold');
    expect(r.state.pendingGold?.red).toBeGreaterThanOrEqual(1);

    const need = r.state.pendingGold!.red!;
    const r2 = reduce(r.state, 'red', { t: 'chooseGoldResource', resources: { wood: need } });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.players.find((p) => p.color === 'red')!.hand.wood).toBe(need);
    expect(r2.state.phase).toBe('main');
  });

  it('estado de mar sobrevive a um round-trip JSON (persistência/snapshot)', () => {
    const s = seaState(2);
    const restored = JSON.parse(JSON.stringify(s)) as GameState;
    expect(restored.expansion).toBe('sea');
    expect(restored.pirate?.hexId).toBe(s.pirate?.hexId);
    expect(restored.islandBonus).toBe(s.islandBonus);
    expect(restored.ships).toEqual({});
    expect(restored.players[0]!.pieces.ships).toBe(15);
    // Continua jogável após restaurar: uma colocação inicial válida passa.
    const vid = restored.board.vertexOrder.find((v) => vertexTouchesMainIsland(restored, v) && distanceRuleOk(restored, v))!;
    expect(reduce(restored, restored.currentPlayer, { t: 'placeSettlement', vertexId: vid }).ok).toBe(true);
  });

  it('estado-base antigo (sem expansion) é tratado como jogo-base', () => {
    const legacy = createInitialState({ seed: 1 }); // sem expansion
    expect(legacy.expansion).toBeUndefined();
    expect(legacy.ships).toBeUndefined();
    expect(legacy.pirate).toBeUndefined();
    // Setup livre (não há restrição de ilha principal no jogo-base).
    const vid = legacy.board.vertexOrder.find((v) => distanceRuleOk(legacy, v))!;
    expect(reduce(legacy, legacy.currentPlayer, { t: 'placeSettlement', vertexId: vid }).ok).toBe(true);
  });

  it('colonizar uma ilha nova concede o VP de ilha', () => {
    const s = seaState(5);
    s.phase = 'main';
    s.pirate = null;
    s.currentPlayer = 'red';

    const v = s.board.vertexOrder.find(
      (vid) =>
        islandsAtVertex(s, vid).length > 0 &&
        distanceRuleOk(s, vid) &&
        s.board.vertices[vid]!.edges.some((e) => isSeaEdge(s, e)),
    )!;
    const e = s.board.vertices[v]!.edges.find((eid) => isSeaEdge(s, eid))!;
    s.ships = { [e]: { owner: 'red', edgeId: e } };
    give(s, 'red', { wood: 1, brick: 1, wool: 1, grain: 1 });

    const island = islandsAtVertex(s, v)[0]!;
    const before = publicScoreOf(s, 'red');
    const r = reduce(s, 'red', { t: 'buildSettlement', vertexId: v });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.color === 'red')!.islandsScored).toContain(island);
    expect(publicScoreOf(r.state, 'red')).toBe(before + 1 + 2);
  });
});
