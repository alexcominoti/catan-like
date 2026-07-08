import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState, type PlayerColor, type Resource, type TradeOffer } from '@trevalis/engine';
import { planBotAction } from '../src/index.js';

/**
 * Testa a ACEITACAO de troca do bot (o ponto "permissivo demais" reportado): um
 * humano propoe uma troca a um bot; `planBotAction` deve devolver o `respondTrade`
 * de aceite so quando a troca for boa para o bot, senao `null` (recusa implicita).
 *
 * Monta um estado 'main' minimo: o humano (red) e o jogador da vez e propoe; o bot
 * (blue) possui uma vila (=> meta "cidade": 2 trigo + 3 minerio) e uma mao dada.
 */
const HUMAN: PlayerColor = 'red';
const BOT: PlayerColor = 'blue';

function stateWithOffer(botHand: Partial<Record<Resource, number>>, offer: Omit<TradeOffer, 'from' | 'to' | 'accepted'>): GameState {
  const base = createInitialState({ seed: 1 });
  // Um vertice qualquer com terreno produtivo vira a vila do bot (habilita a meta cidade).
  const vid = base.board.vertexOrder.find((v) => base.board.vertices[v]!.hexes.length >= 2)!;
  const state: GameState = {
    ...base,
    phase: 'main',
    currentPlayer: HUMAN,
    buildings: { [vid]: { kind: 'settlement', owner: BOT, vertexId: vid } },
    players: base.players.map((p) =>
      p.color === BOT
        ? { ...p, hand: { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...botHand } }
        : p,
    ),
    activeTrade: { from: HUMAN, to: [BOT], accepted: [], ...offer },
  };
  return state;
}

const isBot = (c: PlayerColor) => c === BOT;
const asHard = () => 'hard' as const;
const asMedium = () => 'medium' as const;
const asEasy = () => 'easy' as const;

function accepts(state: GameState, diffOf: (c: PlayerColor) => 'easy' | 'medium' | 'hard'): boolean {
  const move = planBotAction(state, isBot, diffOf);
  return move?.by === BOT && move.action.t === 'respondTrade' && move.action.accept === true;
}

describe('aceitacao de troca do bot (menos permissiva)', () => {
  it('RECUSA (medio/dificil) dar o minerio de que precisa por um recurso inutil', () => {
    // Bot tem trigo suficiente para cidade e 1 minerio; troca leva o minerio embora.
    const state = stateWithOffer(
      { grain: 2, ore: 1, wood: 3 },
      { give: { wood: 1 }, want: { ore: 1 } },
    );
    expect(accepts(state, asMedium)).toBe(false);
    expect(accepts(state, asHard)).toBe(false);
  });

  it('ACEITA (medio/dificil) uma troca que APROXIMA da cidade (recebe minerio que falta)', () => {
    // Bot precisa de minerio p/ cidade e da um trigo de sobra.
    const state = stateWithOffer(
      { grain: 3, ore: 2 },
      { give: { ore: 1 }, want: { grain: 1 } },
    );
    expect(accepts(state, asMedium)).toBe(true);
    expect(accepts(state, asHard)).toBe(true);
  });

  it('RECUSA (medio/dificil) swap lateral inutil que nao aproxima de meta', () => {
    // Troca 1:1 de recursos que nao mudam a distancia para cidade.
    const state = stateWithOffer(
      { wood: 2, brick: 2 },
      { give: { wood: 1 }, want: { brick: 1 } },
    );
    expect(accepts(state, asMedium)).toBe(false);
    expect(accepts(state, asHard)).toBe(false);
  });

  it('FACIL continua permissivo: aceita a mesma troca lateral 1:1', () => {
    const state = stateWithOffer(
      { wood: 2, brick: 2 },
      { give: { wood: 1 }, want: { brick: 1 } },
    );
    expect(accepts(state, asEasy)).toBe(true);
  });

  it('DIFICIL nao alimenta o lider perto de vencer', () => {
    // Uma troca que aproximaria da cidade, mas o proponente esta a 1 PV de vencer.
    const state = stateWithOffer(
      { grain: 3, ore: 2 },
      { give: { ore: 1 }, want: { grain: 1 } },
    );
    state.victoryTarget = 5; // humano com 1 vila (=1 PV)? precisamos elevar o placar do proponente
    // Da ao humano vilas suficientes para ficar a <=2 PV do alvo.
    const v2 = state.board.vertexOrder.filter((v) => !state.buildings[v]).slice(0, 4);
    for (const vid of v2) state.buildings[vid] = { kind: 'settlement', owner: HUMAN, vertexId: vid };
    // Humano agora tem 4 PV, alvo 5 => a <=2 PV de vencer.
    expect(accepts(state, asHard)).toBe(false);
    // Medio ignora a ameaca e aceita (so olha utilidade).
    expect(accepts(state, asMedium)).toBe(true);
  });
});
