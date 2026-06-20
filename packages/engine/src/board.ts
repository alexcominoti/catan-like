import type { Board, Hex, Vertex, Edge } from './types.js';

/**
 * Geometria do tabuleiro classico de 19 hexes (aneis 1 + 6 + 12).
 *
 * Hexes "pointy-top" em coordenadas axiais (q, r). Os vertices e arestas tem
 * IDs estaveis derivados das posicoes de tela arredondadas: como a geometria
 * e fixa, os mesmos cantos sempre recebem os mesmos IDs. Esse grafo e
 * pre-computado uma vez e tratado como imutavel pelo resto do motor.
 */

export const HEX_SIZE = 60;

/** Raio do tabuleiro em hexes a partir do centro (2 => 19 hexes). */
const BOARD_RADIUS = 2;

export function axialToPixel(q: number, r: number, size = HEX_SIZE): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = size * ((3 / 2) * r);
  return { x, y };
}

/** Os 6 cantos de um hex pointy-top, em ordem (canto 0 = topo-direita). */
export function hexCorners(cx: number, cy: number, size = HEX_SIZE): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    out.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return out;
}

function keyOf(x: number, y: number): string {
  // Arredonda para inteiro: cantos compartilhados coincidem com folga (~1e-9).
  return `${Math.round(x)}:${Math.round(y)}`;
}

/** Lista de coordenadas axiais (q, r) dos 19 hexes, em ordem por linha. */
export function axialCoords(): { q: number; r: number }[] {
  const coords: { q: number; r: number }[] = [];
  for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r++) {
    for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q++) {
      if (Math.abs(q) <= BOARD_RADIUS && Math.abs(r) <= BOARD_RADIUS && Math.abs(q + r) <= BOARD_RADIUS) {
        coords.push({ q, r });
      }
    }
  }
  return coords;
}

/**
 * Constroi o grafo geometrico (sem terreno/numero — isso e atribuido no setup).
 * Hexes nascem com terrain 'desert' e number null como placeholders.
 */
export function buildBoardGeometry(): Board {
  const hexes: Record<string, Hex> = {};
  const hexOrder: string[] = [];

  // Mapas temporarios para deduplicar vertices e arestas.
  const vertexKeyToId = new Map<string, string>();
  const vertexAccum = new Map<
    string,
    { x: number; y: number; hexes: Set<string>; edges: Set<string>; adj: Set<string> }
  >();
  const edgeKeyToId = new Map<string, string>();
  const edgeAccum = new Map<string, { v: [string, string]; hexes: Set<string> }>();

  const coords = axialCoords();

  // Passo 1: cria hexes e registra cantos (vertices) deduplicados.
  coords.forEach(({ q, r }, idx) => {
    const id = `h${idx}`;
    const { x: cx, y: cy } = axialToPixel(q, r);
    const corners = hexCorners(cx, cy);
    const cornerIds: string[] = [];

    for (const c of corners) {
      const k = keyOf(c.x, c.y);
      let vid = vertexKeyToId.get(k);
      if (!vid) {
        vid = k; // id temporario = chave; renumeramos depois.
        vertexKeyToId.set(k, vid);
        vertexAccum.set(vid, { x: c.x, y: c.y, hexes: new Set(), edges: new Set(), adj: new Set() });
      }
      vertexAccum.get(vid)!.hexes.add(id);
      cornerIds.push(vid);
    }

    hexes[id] = { id, q, r, cx, cy, terrain: 'desert', number: null, corners: cornerIds };
    hexOrder.push(id);
  });

  // Passo 2: arestas a partir de cantos consecutivos de cada hex.
  for (const hid of hexOrder) {
    const corners = hexes[hid]!.corners;
    for (let i = 0; i < 6; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 6]!;
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      let eid = edgeKeyToId.get(ek);
      if (!eid) {
        eid = ek;
        edgeKeyToId.set(ek, eid);
        edgeAccum.set(eid, { v: a < b ? [a, b] : [b, a], hexes: new Set() });
        vertexAccum.get(a)!.edges.add(eid);
        vertexAccum.get(b)!.edges.add(eid);
        vertexAccum.get(a)!.adj.add(b);
        vertexAccum.get(b)!.adj.add(a);
      }
      edgeAccum.get(eid)!.hexes.add(hid);
    }
  }

  // Passo 3: renumera vertices (ordenados por y, depois x) e arestas para IDs
  // limpos e estaveis (v0.., e0..). A ordenacao geometrica garante estabilidade.
  const sortedVertexTmpIds = [...vertexAccum.keys()].sort((a, b) => {
    const va = vertexAccum.get(a)!;
    const vb = vertexAccum.get(b)!;
    return va.y - vb.y || va.x - vb.x;
  });
  const tmpToVid = new Map<string, string>();
  sortedVertexTmpIds.forEach((tmp, i) => tmpToVid.set(tmp, `v${i}`));

  const sortedEdgeTmpIds = [...edgeAccum.keys()].sort((a, b) => {
    const ea = edgeAccum.get(a)!;
    const eb = edgeAccum.get(b)!;
    const ma = midOf(ea.v, vertexAccum);
    const mb = midOf(eb.v, vertexAccum);
    return ma.y - mb.y || ma.x - mb.x;
  });
  const tmpToEid = new Map<string, string>();
  sortedEdgeTmpIds.forEach((tmp, i) => tmpToEid.set(tmp, `e${i}`));

  // Reescreve as estruturas finais com os IDs limpos.
  const vertices: Record<string, Vertex> = {};
  const vertexOrder: string[] = [];
  for (const tmp of sortedVertexTmpIds) {
    const acc = vertexAccum.get(tmp)!;
    const vid = tmpToVid.get(tmp)!;
    vertices[vid] = {
      id: vid,
      x: acc.x,
      y: acc.y,
      hexes: [...acc.hexes],
      edges: [...acc.edges].map((e) => tmpToEid.get(e)!).sort(),
      adj: [...acc.adj].map((v) => tmpToVid.get(v)!).sort(),
    };
    vertexOrder.push(vid);
  }

  const edges: Record<string, Edge> = {};
  const edgeOrder: string[] = [];
  for (const tmp of sortedEdgeTmpIds) {
    const acc = edgeAccum.get(tmp)!;
    const eid = tmpToEid.get(tmp)!;
    edges[eid] = {
      id: eid,
      v: [tmpToVid.get(acc.v[0])!, tmpToVid.get(acc.v[1])!],
      hexes: [...acc.hexes],
    };
    edgeOrder.push(eid);
  }

  // Atualiza hex.corners para os IDs limpos.
  for (const hid of hexOrder) {
    hexes[hid]!.corners = hexes[hid]!.corners.map((v) => tmpToVid.get(v)!);
  }

  return { hexes, vertices, edges, hexOrder, vertexOrder, edgeOrder };
}

function midOf(
  v: [string, string],
  acc: Map<string, { x: number; y: number }>,
): { x: number; y: number } {
  const a = acc.get(v[0])!;
  const b = acc.get(v[1])!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
