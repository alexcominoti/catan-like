import { RESOURCES, type GameState, type PlayerColor } from './types.js';

/**
 * Projeta o estado autoritativo para a VISAO de um jogador (fog of war). Usado
 * pelo servidor (Fase 2) antes de enviar o estado a cada cliente, para que ninguem
 * receba informacao secreta dos outros:
 *  - a COMPOSICAO da mao dos adversarios (mantem so o total em `hiddenHand`);
 *  - as cartas de progresso dos adversarios (mantem so a contagem em `hiddenDevCount`);
 *  - a ORDEM do baralho de progresso (mantem so a contagem em `devDeckCount`);
 *  - a SEMENTE do PRNG (para nao prever rolagens/roubos/compras futuras).
 *
 * Puro: nao muta o estado original (faz uma copia). O proprio jogador (`viewer`)
 * ve a sua mao e as suas cartas normalmente.
 */
export function projectFor(state: GameState, viewer: PlayerColor): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;

  // Esconde a semente do PRNG (mantem o contador, que sozinho nao preve nada).
  s.rng = { seed: 0, counter: state.rng.counter };

  // Esconde a ordem do baralho de progresso; preserva quantas cartas restam.
  s.devDeckCount = state.devDeck.length;
  s.devDeck = [];

  for (const p of s.players) {
    if (p.color === viewer) continue;
    // Mao do adversario: oculta a composicao, mantem o total.
    p.hiddenHand = RESOURCES.reduce((n, r) => n + p.hand[r], 0);
    for (const r of RESOURCES) p.hand[r] = 0;
    // Cartas de progresso (inclui +1 PV secretos): ocultas; mantem so a contagem.
    p.hiddenDevCount = p.progressCards.length;
    p.progressCards = [];
    p.progressCardsBoughtThisTurn = [];
  }

  return s;
}
