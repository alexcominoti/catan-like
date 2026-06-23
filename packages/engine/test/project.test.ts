import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/setup.js';
import { projectFor } from '../src/project.js';
import { RESOURCES } from '../src/types.js';

describe('projectFor (fog of war)', () => {
  function rich() {
    const s = createInitialState({ seed: 1 });
    // Da cartas e uma carta de progresso a alguns jogadores.
    s.players[0]!.hand.wood = 3;
    s.players[0]!.hand.ore = 1;
    s.players[1]!.hand.brick = 2;
    s.players[1]!.progressCards = ['knight', 'victoryPoint'];
    return s;
  }

  it('mostra a propria mao/cartas ao viewer e ESCONDE as dos adversarios', () => {
    const s = rich();
    const view = projectFor(s, 'red'); // players[0] = red

    const me = view.players[0]!;
    expect(me.hand.wood).toBe(3); // a minha mao fica visivel
    expect(me.hiddenHand).toBeUndefined();

    const opp = view.players[1]!; // blue
    expect(RESOURCES.every((r) => opp.hand[r] === 0)).toBe(true); // composicao oculta
    expect(opp.hiddenHand).toBe(2); // total preservado
    expect(opp.progressCards).toEqual([]); // cartas ocultas
    expect(opp.hiddenDevCount).toBe(2); // contagem preservada
  });

  it('esconde a ordem do baralho e a semente do PRNG, mantendo as contagens', () => {
    const s = rich();
    const view = projectFor(s, 'red');
    expect(view.devDeck).toEqual([]);
    expect(view.devDeckCount).toBe(s.devDeck.length);
    expect(view.rng.seed).toBe(0);
  });

  it('e puro: nao muta o estado original', () => {
    const s = rich();
    const before = JSON.stringify(s);
    projectFor(s, 'red');
    expect(JSON.stringify(s)).toBe(before);
  });
});
