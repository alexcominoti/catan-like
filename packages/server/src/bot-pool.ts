/**
 * Pool de worker_threads para a IA dos bots (Fase 1). Tira o `planBotAction` do
 * event loop principal — sob carga, o compute de um bot deixa de congelar os
 * WebSockets e as outras partidas. Mede o ganho pela Fase 0 (`eventLoopMs`).
 *
 * BLINDADO: se um worker não puder ser criado ou falhar (ex.: tsx não carregar no
 * worker), o pool é DESATIVADO e todo job cai no `planSync` (main thread) — o jogo
 * roda idêntico a antes, nunca quebra. Desligado nos testes (VITEST) e com
 * `BOT_WORKERS=0`.
 */
import { Worker } from 'node:worker_threads';
import { planBotAction, type BotMove, type Difficulty } from '@trevalis/bot';
import type { GameState, PlayerColor } from '@trevalis/engine';
import { recordBotMove } from './metrics.js';

export interface BotJob {
  state: GameState;
  bots: PlayerColor[];
  difficulty: Record<PlayerColor, Difficulty>;
}

interface WorkerReply {
  move: BotMove | null;
  computeMs: number;
}

/** Fallback SÍNCRONO (main thread): reconstrói os predicados e roda a IA direto. */
function planSync(job: BotJob): BotMove | null {
  const botSet = new Set(job.bots);
  return planBotAction(job.state, (c) => botSet.has(c), (c) => job.difficulty[c] ?? 'medium');
}

// Nº de workers: 0 nos testes (evita flakiness) e configurável por BOT_WORKERS.
// 1 já basta para desafogar o event loop; mais só ajudam com mais vCPUs.
const DESIRED = process.env.VITEST
  ? 0
  : Math.max(0, Math.floor(Number(process.env.BOT_WORKERS ?? '1')));

interface Waiter {
  job: BotJob;
  resolve: (m: BotMove | null) => void;
}

class BotPool {
  private readonly all: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly busy = new Map<Worker, Waiter>();
  private readonly queue: Waiter[] = [];
  private started = false;
  private disabled = DESIRED === 0;

  /** Cria os workers na 1ª chamada (lazy). Falha vira fallback síncrono. */
  private ensureStarted(): void {
    if (this.started || this.disabled) return;
    this.started = true;
    for (let i = 0; i < DESIRED; i++) {
      if (!this.spawn()) {
        this.disable('não foi possível criar worker de bot');
        return;
      }
    }
  }

  private spawn(): boolean {
    try {
      // Carrega o worker .ts sob tsx (o servidor roda via tsx, sem build).
      const w = new Worker(new URL('./bot-worker.ts', import.meta.url), {
        execArgv: ['--import', 'tsx'],
      });
      w.on('message', (m: WorkerReply) => this.onReply(w, m));
      w.on('error', () => this.onFailure(w));
      w.on('exit', (code) => { if (code !== 0) this.onFailure(w); });
      this.all.push(w);
      this.idle.push(w);
      return true;
    } catch {
      return false;
    }
  }

  private onReply(w: Worker, reply: WorkerReply): void {
    const waiter = this.busy.get(w);
    this.busy.delete(w);
    recordBotMove(reply.computeMs);
    waiter?.resolve(reply.move);
    // Libera o worker: puxa o próximo da fila ou volta para os ociosos.
    const next = this.queue.shift();
    if (next) this.assign(w, next);
    else this.idle.push(w);
  }

  /** Worker morreu/erro: o job dele cai no fallback e o worker sai do pool. */
  private onFailure(w: Worker): void {
    const waiter = this.busy.get(w);
    this.busy.delete(w);
    const i = this.all.indexOf(w);
    if (i >= 0) this.all.splice(i, 1);
    const j = this.idle.indexOf(w);
    if (j >= 0) this.idle.splice(j, 1);
    void w.terminate().catch(() => {});
    if (waiter) waiter.resolve(planSync(waiter.job));
    // Sem workers vivos: desativa (evita spawnar erros a cada job).
    if (this.all.length === 0) this.disable('todos os workers de bot falharam');
  }

  private disable(reason: string): void {
    if (this.disabled) return;
    this.disabled = true;
    // eslint-disable-next-line no-console
    console.warn(`[trevalis] pool de bots desativado — fallback síncrono (${reason}).`);
    for (const waiter of this.queue.splice(0)) waiter.resolve(planSync(waiter.job));
  }

  private assign(w: Worker, waiter: Waiter): void {
    this.busy.set(w, waiter);
    try {
      w.postMessage(waiter.job);
    } catch {
      this.busy.delete(w);
      this.onFailure(w);
      waiter.resolve(planSync(waiter.job));
    }
  }

  plan(job: BotJob): Promise<BotMove | null> {
    this.ensureStarted();
    if (this.disabled) return Promise.resolve(planSync(job));
    return new Promise((resolve) => {
      const waiter: Waiter = { job, resolve };
      const w = this.idle.pop();
      if (w) this.assign(w, waiter);
      else this.queue.push(waiter);
    });
  }
}

const pool = new BotPool();

/** Próxima jogada de bot, computada FORA do event loop (ou síncrona no fallback). */
export function planBotMove(
  state: GameState,
  bots: PlayerColor[],
  difficulty: Record<PlayerColor, Difficulty>,
): Promise<BotMove | null> {
  return pool.plan({ state, bots, difficulty });
}
