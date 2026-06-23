import { describe, expect, it } from 'vitest';
import { buildBoardGeometry } from '../src/board.js';

describe('grafo do tabuleiro', () => {
  const board = buildBoardGeometry();

  it('tem 19 hexes, 54 vertices e 72 arestas', () => {
    expect(board.hexOrder).toHaveLength(19);
    expect(board.vertexOrder).toHaveLength(54);
    expect(board.edgeOrder).toHaveLength(72);
  });

  it('cada hex tem exatamente 6 cantos distintos e validos', () => {
    for (const hid of board.hexOrder) {
      const hex = board.hexes[hid]!;
      expect(hex.corners).toHaveLength(6);
      expect(new Set(hex.corners).size).toBe(6);
      for (const v of hex.corners) expect(board.vertices[v]).toBeDefined();
    }
  });

  it('cada aresta conecta 2 vertices e toca 1 ou 2 hexes', () => {
    for (const eid of board.edgeOrder) {
      const e = board.edges[eid]!;
      expect(e.v).toHaveLength(2);
      expect(board.vertices[e.v[0]]).toBeDefined();
      expect(board.vertices[e.v[1]]).toBeDefined();
      expect(e.hexes.length).toBeGreaterThanOrEqual(1);
      expect(e.hexes.length).toBeLessThanOrEqual(2);
    }
  });

  it('a adjacencia de vertices e simetrica', () => {
    for (const vid of board.vertexOrder) {
      const v = board.vertices[vid]!;
      for (const nb of v.adj) {
        expect(board.vertices[nb]!.adj).toContain(vid);
      }
    }
  });

  it('e deterministico (IDs estaveis entre construcoes)', () => {
    const b2 = buildBoardGeometry();
    expect(b2.vertexOrder).toEqual(board.vertexOrder);
    expect(b2.edgeOrder).toEqual(board.edgeOrder);
    expect(b2.hexes['h0']!.corners).toEqual(board.hexes['h0']!.corners);
  });

  it('arestas = vertices + (hexes - 1) [planar e conexo]', () => {
    // Para um tabuleiro planar conexo: V - E + (H + 1) = 2  =>  E = V + (H - 1).
    expect(board.edgeOrder.length).toBe(board.vertexOrder.length + board.hexOrder.length - 1);
  });
});

describe('grafo do tabuleiro GRANDE (30 hexes)', () => {
  const board = buildBoardGeometry('large');

  it('tem 30 hexes e 11 portos', () => {
    expect(board.hexOrder).toHaveLength(30);
    expect(board.ports).toHaveLength(11);
  });

  it('e planar e conexo (E = V + H - 1) e cada hex tem 6 cantos', () => {
    expect(board.edgeOrder.length).toBe(board.vertexOrder.length + board.hexOrder.length - 1);
    for (const hid of board.hexOrder) {
      expect(new Set(board.hexes[hid]!.corners).size).toBe(6);
    }
  });

  it('e deterministico', () => {
    const b2 = buildBoardGeometry('large');
    expect(b2.vertexOrder).toEqual(board.vertexOrder);
    expect(b2.edgeOrder).toEqual(board.edgeOrder);
  });
});
