/**
 * Smoke test do pool de bots sob tsx (Fase 1) — confirma que o worker CARREGA e
 * devolve a MESMA jogada que o cálculo síncrono (bot determinístico).
 *
 *   npx tsx packages/server/scripts/pool-smoke.ts
 *
 * Se aparecer "pool de bots desativado", o worker sob tsx falhou (caiu no
 * fallback) — a integração tsx precisa de ajuste. Sem esse aviso e com
 * "iguais: true", o offload está funcionando.
 */
import { performance } from 'node:perf_hooks';
import { planBotAction, type Difficulty } from '@trevalis/bot';
import type { PlayerColor } from '@trevalis/engine';
import { GameRoom } from '../src/room.js';
import { planBotMove } from '../src/bot-pool.js';
import type { RoomConfig } from '../src/protocol.js';

const all: PlayerColor[] = ['red', 'blue', 'white', 'orange'];
const botDifficulty = Object.fromEntries(all.map((c) => [c, 'medium'])) as Record<PlayerColor, Difficulty>;
// Todos humanos → o construtor NÃO roda bots; o estado fica no setup1 fresco.
const cfg: RoomConfig = {
  seed: 42,
  boardLayout: 'standard',
  pace: 'normal',
  players: all.map((c, i) => ({ color: c, name: `P${i + 1}`, userId: `u-${c}` })),
  bots: [],
  botDifficulty,
  numberLayout: 'balanced',
  desert: 'random',
  pointsToWin: 10,
  discardLimit: 7,
  friendlyRobber: false,
  balancedDice: false,
};

const room = new GameRoom('SMOKE', cfg);
const state = room.state;
const cur = state.currentPlayer;

const sync = planBotAction(state, (c) => c === cur, () => 'medium');
const t0 = performance.now();
const viaWorker = await planBotMove(state, [cur], botDifficulty);
const dt = performance.now() - t0;

console.log('sync  :', JSON.stringify(sync));
console.log('worker:', JSON.stringify(viaWorker), `(${dt.toFixed(1)}ms)`);
console.log('iguais:', JSON.stringify(sync) === JSON.stringify(viaWorker));
process.exit(JSON.stringify(sync) === JSON.stringify(viaWorker) ? 0 : 1);
