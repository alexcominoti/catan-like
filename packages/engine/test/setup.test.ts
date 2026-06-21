import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/setup.js';
import { RESOURCES, type Terrain } from '../src/types.js';

describe('estado inicial', () => {
  it('e deterministico para a mesma seed', () => {
    const a = createInitialState({ seed: 42 });
    const b = createInitialState({ seed: 42 });
    const terrA = a.board.hexOrder.map((h) => a.board.hexes[h]!.terrain);
    const terrB = b.board.hexOrder.map((h) => b.board.hexes[h]!.terrain);
    expect(terrA).toEqual(terrB);
    expect(a.devDeck).toEqual(b.devDeck);
    expect(a.blocker).toEqual(b.blocker);
  });

  it('seeds diferentes geram tabuleiros diferentes', () => {
    const a = createInitialState({ seed: 1 });
    const b = createInitialState({ seed: 2 });
    const terrA = a.board.hexOrder.map((h) => a.board.hexes[h]!.terrain).join(',');
    const terrB = b.board.hexOrder.map((h) => b.board.hexes[h]!.terrain).join(',');
    expect(terrA).not.toEqual(terrB);
  });

  it('usa a distribuicao classica de terrenos', () => {
    const s = createInitialState({ seed: 7 });
    const counts = {} as Record<Terrain, number>;
    for (const h of s.board.hexOrder) {
      const t = s.board.hexes[h]!.terrain;
      counts[t] = (counts[t] ?? 0) + 1;
    }
    expect(counts).toEqual({ forest: 4, pasture: 4, field: 4, hills: 3, mountain: 3, desert: 1 });
  });

  it('numera todos os hexes nao-deserto (e so eles)', () => {
    const s = createInitialState({ seed: 7 });
    for (const h of s.board.hexOrder) {
      const hex = s.board.hexes[h]!;
      if (hex.terrain === 'desert') expect(hex.number).toBeNull();
      else expect(hex.number).toBeGreaterThanOrEqual(2);
    }
  });

  it("desert: 'center' fixa o deserto no hex central", () => {
    const s = createInitialState({ seed: 7, desert: 'center' });
    const desert = s.board.hexes[s.blocker.hexId]!;
    expect(desert.terrain).toBe('desert');
    expect(desert.q).toBe(0);
    expect(desert.r).toBe(0);
  });

  it("numberLayout: 'balanced' nunca poe dois 6/8 adjacentes", () => {
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
    for (const seed of [1, 2, 3, 42, 1234]) {
      const s = createInitialState({ seed, numberLayout: 'balanced' });
      const byQR = new Map<string, number | null>();
      for (const h of s.board.hexOrder) {
        const hex = s.board.hexes[h]!;
        byQR.set(`${hex.q},${hex.r}`, hex.number);
      }
      for (const h of s.board.hexOrder) {
        const hex = s.board.hexes[h]!;
        if (hex.number !== 6 && hex.number !== 8) continue;
        for (const [dq, dr] of dirs) {
          const nb = byQR.get(`${hex.q + dq},${hex.r + dr}`);
          expect(nb === 6 || nb === 8).toBe(false);
        }
      }
    }
  });

  it('comeca com o bloqueador no deserto e banco cheio', () => {
    const s = createInitialState({ seed: 7 });
    expect(s.board.hexes[s.blocker.hexId]!.terrain).toBe('desert');
    for (const r of RESOURCES) expect(s.bank[r]).toBe(19);
    expect(s.players).toHaveLength(4);
    expect(s.phase).toBe('setup1');
  });
});
