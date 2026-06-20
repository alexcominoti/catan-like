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

  it('comeca com o bloqueador no deserto e banco cheio', () => {
    const s = createInitialState({ seed: 7 });
    expect(s.board.hexes[s.blocker.hexId]!.terrain).toBe('desert');
    for (const r of RESOURCES) expect(s.bank[r]).toBe(19);
    expect(s.players).toHaveLength(4);
    expect(s.phase).toBe('setup1');
  });
});
