import { RESOURCES, type GameState, type PlayerColor } from './types.js';

/**
 * Nucleo comum de `projectFor`/`projectForSpectator`: esconde a semente do PRNG,
 * a ordem do baralho de progresso, e a mao/cartas de cada jogador para o qual
 * `hide(color)` devolve true. Puro: nao muta o estado original.
 */
function project(state: GameState, hide: (color: PlayerColor) => boolean): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;

  // Esconde a semente do PRNG (mantem o contador, que sozinho nao preve nada).
  s.rng = { seed: 0, counter: state.rng.counter };

  // Esconde a ordem do baralho de progresso; preserva quantas cartas restam.
  s.devDeckCount = state.devDeck.length;
  s.devDeck = [];

  // Dados balanceados: o saco revela as PROXIMAS rolagens — esconde-o do cliente
  // (a flag `balancedDice` pode ficar; ela nao entrega nada).
  delete s.diceBag;

  for (const p of s.players) {
    if (!hide(p.color)) continue;
    // Mao oculta: esconde a composicao, mantem o total.
    p.hiddenHand = RESOURCES.reduce((n, r) => n + p.hand[r], 0);
    for (const r of RESOURCES) p.hand[r] = 0;
    // Cartas de progresso (inclui +1 PV secretos): ocultas; mantem so a contagem.
    p.hiddenDevCount = p.progressCards.length;
    p.progressCards = [];
    p.progressCardsBoughtThisTurn = [];
  }

  return s;
}

/**
 * Projeta o estado autoritativo para a VISAO de um jogador (fog of war). Usado
 * pelo servidor antes de enviar o estado a cada cliente, para que ninguem
 * receba informacao secreta dos outros. O proprio jogador (`viewer`) ve a sua
 * mao e as suas cartas normalmente.
 */
export function projectFor(state: GameState, viewer: PlayerColor): GameState {
  return project(state, (c) => c !== viewer);
}

/**
 * Projeta o estado para um ESPECTADOR (nao e nenhum dos jogadores): esconde a
 * mao/cartas de TODOS, igual `projectFor` faria para um adversario.
 */
export function projectForSpectator(state: GameState): GameState {
  return project(state, () => true);
}
