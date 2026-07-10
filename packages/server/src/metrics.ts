/**
 * Métricas de aplicação (Fase 0 de escala) — números agregados, SEM dados de
 * usuário, para medir o teto real sob carga: lag do event loop, tempo de compute
 * dos bots (o gargalo de CPU), conexões WS e salas/partidas ativas.
 *
 * Exposto por GET /api/metrics (ver http.ts). Só agregados (nada sensível); em
 * produção pode ser fechado com METRICS_TOKEN.
 */
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

// Histograma do atraso do event loop (ns). Habilitado uma vez no import.
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

// Buffer circular dos tempos (ms) de compute dos bots (planBotAction) — o call
// caro. Guardamos os últimos N para calcular p50/p95 recentes; `botTotal` é o
// acumulado desde o boot.
const BOT_BUF = 300;
const botDurations: number[] = [];
let botTotal = 0;

/** Registra a duração (ms) de UMA decisão de bot. Chamado em GameRoom.stepBot. */
export function recordBotMove(ms: number): void {
  botTotal += 1;
  botDurations.push(ms);
  if (botDurations.length > BOT_BUF) botDurations.shift();
}

/** Mede e registra `fn` como uma decisão de bot, devolvendo o resultado. */
export function timeBotMove<T>(fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    recordBotMove(performance.now() - t0);
  }
}

// O contador de sockets WS vive em server.ts (dono do WebSocketServer); ele
// injeta um provedor aqui para o /api/metrics ler sem acoplar as camadas.
let wsCount: () => number = () => 0;
export function setWsCountProvider(fn: () => number): void {
  wsCount = fn;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface RoomStats {
  rooms: number;
  games: number;
  inProgress: number;
  connections: number;
  seatedHumans: number;
  botsAI: number;
}

/** Instantâneo de métricas para o endpoint. `rooms` vem do RoomManager.stats(). */
export function metricsSnapshot(rooms: RoomStats) {
  const sorted = [...botDurations].sort((a, b) => a - b);
  const mem = process.memoryUsage();
  // O histograma pode não ter amostras ainda (mean = NaN) — normaliza para 0.
  const toMs = (ns: number) => round1((Number.isFinite(ns) ? ns : 0) / 1e6);
  return {
    uptimeSec: Math.round(process.uptime()),
    ws: wsCount(),
    rooms,
    // Atraso do event loop: >50–100ms sob carga = servidor engasgando (culpado
    // provável: compute de bot bloqueando o loop). Ver Fase 1 (worker_threads).
    eventLoopMs: {
      mean: toMs(loopDelay.mean),
      p95: toMs(loopDelay.percentile(95)),
      max: toMs(loopDelay.max),
    },
    // Tempo de decisão dos bots (o gargalo de CPU).
    botMoves: {
      total: botTotal,
      sampled: botDurations.length,
      p50Ms: round1(percentile(sorted, 50)),
      p95Ms: round1(percentile(sorted, 95)),
      maxMs: round1(sorted[sorted.length - 1] ?? 0),
    },
    memoryMb: {
      rss: round1(mem.rss / 1048576),
      heapUsed: round1(mem.heapUsed / 1048576),
    },
  };
}
