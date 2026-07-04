import { describe, expect, it } from 'vitest';
import { karmaPercent, meetsKarma, KARMA_MIN_SAMPLE } from '../src/karma.js';

describe('karmaPercent', () => {
  it('mostra 100% enquanto não há amostra suficiente', () => {
    expect(karmaPercent(0, 0)).toBe(100);
    expect(karmaPercent(1, 0)).toBe(100); // total < KARMA_MIN_SAMPLE
    expect(karmaPercent(0, KARMA_MIN_SAMPLE - 1)).toBe(100);
  });

  it('com amostra suficiente, é a razão concluídas / total', () => {
    expect(karmaPercent(3, 0)).toBe(100);
    expect(karmaPercent(3, 1)).toBe(75);
    expect(karmaPercent(1, 3)).toBe(25);
    expect(karmaPercent(9, 1)).toBe(90);
  });

  it('arredonda para o inteiro mais próximo', () => {
    expect(karmaPercent(2, 1)).toBe(67); // 66.6…
    expect(karmaPercent(1, 2)).toBe(33); // 33.3…
  });
});

describe('meetsKarma', () => {
  it('sem filtro (min 0) qualquer karma passa', () => {
    expect(meetsKarma(0, 0)).toBe(true);
  });

  it('bloqueia abaixo do mínimo, passa no limite ou acima', () => {
    expect(meetsKarma(74, 75)).toBe(false);
    expect(meetsKarma(75, 75)).toBe(true);
    expect(meetsKarma(100, 75)).toBe(true);
  });
});
