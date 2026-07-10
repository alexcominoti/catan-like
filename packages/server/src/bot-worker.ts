/**
 * Worker thread da IA dos bots (Fase 1). Roda `planBotAction` FORA do event loop
 * principal — o compute pesado (nível difícil: função de valor + simulação) não
 * congela mais o WebSocket/outras partidas. O bot é PURO e determinístico, então
 * a jogada é idêntica à do main thread.
 *
 * Recebe dados (não closures): `{ state, bots, difficulty }` e devolve
 * `{ move, computeMs }`. Os predicados `isBot`/`difficultyOf` são reconstruídos
 * aqui a partir dos dados. Carregado sob `tsx` (ver bot-pool.ts).
 */
import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { planBotAction, type BotMove, type Difficulty } from '@trevalis/bot';
import type { GameState, PlayerColor } from '@trevalis/engine';

interface Job {
  state: GameState;
  bots: PlayerColor[];
  difficulty: Record<PlayerColor, Difficulty>;
}

if (!parentPort) throw new Error('bot-worker deve rodar como worker_thread');
const port = parentPort;

port.on('message', (job: Job) => {
  const t0 = performance.now();
  const botSet = new Set(job.bots);
  const move: BotMove | null = planBotAction(
    job.state,
    (c) => botSet.has(c),
    (c) => job.difficulty[c] ?? 'medium',
  );
  port.postMessage({ move, computeMs: performance.now() - t0 });
});
