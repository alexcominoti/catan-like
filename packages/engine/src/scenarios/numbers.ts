/**
 * Atribuicao de tokens numericos a hexes, compartilhada pelos cenarios (base e
 * Navegadores). 'balanced' evita que dois numeros vermelhos (6/8) fiquem
 * adjacentes; 'random' apenas embaralha. Puro: consome e devolve o RngState.
 */
import { shuffle } from '../rng.js';
import type { Board, RngState } from '../types.js';
import type { NumberLayout } from '../setup.js';

/** Numeros "vermelhos" (alta probabilidade) que nao devem se tocar no modo balanced. */
const RED_NUMBERS = new Set([6, 8]);

/** Direcoes axiais para vizinhanca de hexes. */
const AXIAL_DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];

/** Mapa hexId -> hexIds vizinhos (compartilham aresta). */
export function hexAdjacency(board: Board): Map<string, string[]> {
  const byQR = new Map<string, string>();
  for (const hid of board.hexOrder) {
    const h = board.hexes[hid]!;
    byQR.set(`${h.q},${h.r}`, hid);
  }
  const adj = new Map<string, string[]>();
  for (const hid of board.hexOrder) {
    const h = board.hexes[hid]!;
    const nbs: string[] = [];
    for (const [dq, dr] of AXIAL_DIRS) {
      const nb = byQR.get(`${h.q + dq},${h.r + dr}`);
      if (nb) nbs.push(nb);
    }
    adj.set(hid, nbs);
  }
  return adj;
}

/**
 * Atribui os numeros de `numberBag` aos hexes `ids` conforme o layout. No modo
 * 'balanced', tenta ate 500 embaralhamentos ate nenhum par 6/8 se tocar (fallback
 * improvavel: aceita o ultimo). Muta `board.hexes[id].number`.
 */
export function assignNumbers(
  board: Board,
  ids: string[],
  numberBag: number[],
  rng: RngState,
  layout: NumberLayout,
): RngState {
  if (layout !== 'balanced') {
    const n = shuffle(rng, numberBag);
    ids.forEach((hid, i) => (board.hexes[hid]!.number = n.value[i]!));
    return n.rng;
  }

  const adj = hexAdjacency(board);
  let cur = rng;
  for (let attempt = 0; attempt < 500; attempt++) {
    const n = shuffle(cur, numberBag);
    cur = n.rng;
    const assign = new Map<string, number>();
    ids.forEach((hid, i) => assign.set(hid, n.value[i]!));
    let ok = true;
    outer: for (const hid of ids) {
      if (!RED_NUMBERS.has(assign.get(hid)!)) continue;
      for (const nb of adj.get(hid) ?? []) {
        const nn = assign.get(nb);
        if (nn !== undefined && RED_NUMBERS.has(nn)) {
          ok = false;
          break outer;
        }
      }
    }
    if (ok) {
      for (const hid of ids) board.hexes[hid]!.number = assign.get(hid)!;
      return cur;
    }
  }
  // Fallback improvavel: aceita o ultimo embaralhamento.
  const n = shuffle(cur, numberBag);
  ids.forEach((hid, i) => (board.hexes[hid]!.number = n.value[i]!));
  return n.rng;
}
