/**
 * Registry de cenarios de mapa.
 *
 * Um "cenario" define TUDO que e especifico do mapa/expansao ao montar o estado
 * inicial: a geometria + preenchimento do tabuleiro, onde comeca o bloqueador (e o
 * pirata), o saco do baralho de progresso, o tamanho do banco, as pecas iniciais e
 * eventuais parametros de expansao (ex.: VP de ilha em Navegadores). O
 * `createInitialState` (setup.ts) orquestra o que e GENERICO (jogadores,
 * embaralhamento do baralho, saco de dados balanceados) em cima disso.
 *
 * A familia `base` (tamanhos standard/large/huge) vive em ./base.ts. Navegadores
 * (`sea`) entra em ./sea.ts numa fase seguinte; ate la, cai no builder da base.
 */
import type { Board, ExpansionId, ProgressCard, RngState } from '../types.js';
import type { BoardLayout } from '../board.js';
// Type-only (erased): sem ciclo de runtime — o runtime flui setup -> scenarios.
import type { DesertPlacement, NumberLayout } from '../setup.js';
import { buildBaseScenario } from './base.js';
import { buildSeaScenario } from './sea.js';

/** Estoque inicial de pecas de cada jogador. `ships` so existe em Navegadores. */
export interface StartingPieces {
  roads: number;
  settlements: number;
  cities: number;
  ships?: number;
}

/** Knobs de geracao que um cenario entende (subconjunto de SetupOptions). */
export interface ScenarioOptions {
  boardLayout: BoardLayout;
  numberLayout: NumberLayout;
  desert: DesertPlacement;
  /** Id do cenario dentro da expansao (Navegadores tera varios). Opcional. */
  scenario?: string;
}

/** Tudo que um cenario define sobre o mapa/estado inicial (fora o generico). */
export interface BuiltScenario {
  board: Board;
  expansion: ExpansionId;
  /** Hex onde o bloqueador (ladrao) comeca — um deserto na base. */
  blockerHexId: string;
  /** Navegadores: hex de mar onde o pirata comeca (ausente na base). */
  pirateHexId?: string;
  /** Saco do baralho de progresso (ainda NAO embaralhado). */
  devDeckBag: ProgressCard[];
  bankPerResource: number;
  startingPieces: StartingPieces;
  /** Navegadores: VP por colonizar uma ilha nova (ausente na base). */
  islandBonus?: number;
  /** RNG apos consumir o que o cenario precisou (terrenos/numeros/portos). */
  rng: RngState;
}

export type ScenarioBuilder = (rng: RngState, opts: ScenarioOptions) => BuiltScenario;

/**
 * Monta o cenario da expansao pedida. Default (e fallback) = base. O `createRng`
 * ja foi chamado por quem invoca; o builder recebe o `rng` e devolve-o avancado,
 * preservando a ordem de consumo (base para o determinismo/replays).
 */
export function buildScenario(
  expansion: ExpansionId,
  rng: RngState,
  opts: ScenarioOptions,
): BuiltScenario {
  switch (expansion) {
    case 'sea':
      return buildSeaScenario(rng, opts);
    case 'base':
    default:
      return buildBaseScenario(rng, opts);
  }
}
