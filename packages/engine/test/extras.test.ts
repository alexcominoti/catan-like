import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/setup.js';
import { reduce } from '../src/reduce.js';
import { maritimeRate } from '../src/rules.js';
import type { GameState, PlayerColor, Resource } from '../src/types.js';

/** Atalho: estado em fase principal com red jogando e flags limpas. */
function mainState(seed = 1): GameState {
  const s = createInitialState({ seed });
  s.phase = 'main';
  s.currentPlayer = 'red';
  return s;
}

describe('portos', () => {
  it('gera 9 portos: 4 genericos + 1 de cada recurso', () => {
    const s = createInitialState({ seed: 3 });
    expect(s.board.ports).toHaveLength(9);
    const counts = new Map<string, number>();
    for (const p of s.board.ports) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    expect(counts.get('generic')).toBe(4);
    for (const r of ['wood', 'brick', 'wool', 'grain', 'ore']) expect(counts.get(r)).toBe(1);
  });

  it('cada porto fica numa aresta costeira (1 hex vizinho)', () => {
    const s = createInitialState({ seed: 3 });
    for (const p of s.board.ports) {
      expect(s.board.edges[p.edgeId]!.hexes).toHaveLength(1);
    }
  });

  it('e deterministico para a mesma seed', () => {
    const a = createInitialState({ seed: 9 });
    const b = createInitialState({ seed: 9 });
    expect(a.board.ports.map((p) => `${p.edgeId}:${p.type}`)).toEqual(
      b.board.ports.map((p) => `${p.edgeId}:${p.type}`),
    );
  });
});

describe('taxa maritima', () => {
  it('é 4:1 sem porto, 3:1 em porto generico, 2:1 no porto do recurso', () => {
    const s = mainState();
    const generic = s.board.ports.find((p) => p.type === 'generic')!;
    const woodPort = s.board.ports.find((p) => p.type === 'wood')!;
    expect(maritimeRate(s, 'red', 'wood')).toBe(4);

    s.buildings[generic.vertices[0]] = { kind: 'settlement', owner: 'red', vertexId: generic.vertices[0] };
    expect(maritimeRate(s, 'red', 'brick')).toBe(3);

    s.buildings[woodPort.vertices[0]] = { kind: 'settlement', owner: 'red', vertexId: woodPort.vertices[0] };
    expect(maritimeRate(s, 'red', 'wood')).toBe(2);
  });
});

describe('cartas de progresso', () => {
  it('Monopolio recolhe o recurso de todos os adversarios', () => {
    const s = mainState();
    s.players[0]!.progressCards = ['monopoly'];
    s.players[1]!.hand.wood = 3;
    s.players[2]!.hand.wood = 2;
    s.players[0]!.hand.wood = 1;
    const r = reduce(s, 'red', { t: 'playMonopoly', resource: 'wood' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0]!.hand.wood).toBe(6);
    expect(r.state.players[1]!.hand.wood).toBe(0);
    expect(r.state.players[2]!.hand.wood).toBe(0);
  });

  it('+2 Recursos pega 2 cartas do banco', () => {
    const s = mainState();
    s.players[0]!.progressCards = ['yearOfPlenty'];
    const r = reduce(s, 'red', { t: 'playYearOfPlenty', resources: ['wood', 'ore'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0]!.hand.wood).toBe(1);
    expect(r.state.players[0]!.hand.ore).toBe(1);
    expect(r.state.bank.wood).toBe(18);
    expect(r.state.bank.ore).toBe(18);
  });

  it('2 Estradas concede 2 estradas gratis', () => {
    const s = mainState();
    s.players[0]!.progressCards = ['roadBuilding'];
    const v0 = s.board.vertexOrder[0]!;
    const e0 = s.board.vertices[v0]!.edges[0]!;
    const e1 = s.board.vertices[v0]!.edges[1]!;
    s.buildings[v0] = { kind: 'settlement', owner: 'red', vertexId: v0 };
    s.roads[e0] = { owner: 'red', edgeId: e0 };

    const r1 = reduce(s, 'red', { t: 'playRoadBuilding' });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.pendingFreeRoads).toBe(2);

    const r2 = reduce(r1.state, 'red', { t: 'buildRoad', edgeId: e1 });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.pendingFreeRoads).toBe(1);
    expect(r2.state.roads[e1]!.owner).toBe('red');
    // nao gastou recursos (mao continua vazia)
    expect(r2.state.players[0]!.hand.wood).toBe(0);
  });

  it('Cavaleiro entra no fluxo do bloqueador e conta para o Maior Exercito', () => {
    const s = mainState();
    s.players[0]!.knightsPlayed = 2;
    s.players[0]!.progressCards = ['knight'];
    const r = reduce(s, 'red', { t: 'playKnight' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0]!.knightsPlayed).toBe(3);
    expect(r.state.largestArmy.owner).toBe('red');
    expect(r.state.phase).toBe('moveBlocker');
    expect(r.state.returnPhaseAfterBlocker).toBe('main');
  });

  it('impede jogar duas cartas no mesmo turno', () => {
    const s = mainState();
    s.players[0]!.progressCards = ['monopoly', 'yearOfPlenty'];
    const r1 = reduce(s, 'red', { t: 'playMonopoly', resource: 'wood' });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = reduce(r1.state, 'red', { t: 'playYearOfPlenty', resources: ['wood', 'wood'] });
    expect(r2.ok).toBe(false);
  });
});

describe('comercio entre jogadores', () => {
  function withResources(): GameState {
    const s = mainState();
    s.players[0]!.hand.wood = 2; // red
    s.players[1]!.hand.brick = 1; // blue
    return s;
  }

  it('propor -> aceitar -> confirmar troca os recursos', () => {
    const s = withResources();
    const r1 = reduce(s, 'red', { t: 'proposeTrade', give: { wood: 2 }, want: { brick: 1 }, to: ['blue'] });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.activeTrade?.from).toBe('red');

    const r2 = reduce(r1.state, 'blue', { t: 'respondTrade', accept: true });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.activeTrade?.accepted).toContain('blue');

    const r3 = reduce(r2.state, 'red', { t: 'confirmTrade', with: 'blue' });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.state.players[0]!.hand.wood).toBe(0);
    expect(r3.state.players[0]!.hand.brick).toBe(1);
    expect(r3.state.players[1]!.hand.wood).toBe(2);
    expect(r3.state.players[1]!.hand.brick).toBe(0);
    expect(r3.state.activeTrade).toBeNull();
  });

  it('nao deixa confirmar com quem nao aceitou', () => {
    const s = withResources();
    const r1 = reduce(s, 'red', { t: 'proposeTrade', give: { wood: 2 }, want: { brick: 1 } });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = reduce(r1.state, 'red', { t: 'confirmTrade', with: 'blue' });
    expect(r2.ok).toBe(false);
  });

  it('rejeita proposta que o proponente nao pode pagar', () => {
    const s = mainState();
    const r = reduce(s, 'red', { t: 'proposeTrade', give: { wood: 5 }, want: { brick: 1 } });
    expect(r.ok).toBe(false);
  });
});
