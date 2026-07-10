/**
 * Load test SEM dependências (usa fetch/WebSocket globais do Node 22) — Fase 0.
 *
 * Mede dois tetos independentes e correlaciona com /api/metrics:
 *  - HTTP: N workers batendo num path por D segundos → req/s + latência p50/p95/max.
 *  - WS:   abre C conexões WebSocket em /ws → quantas chegam a OPEN + tempo de conexão
 *          (mede o teto de concorrência do Fly + handling de sockets do Node).
 *
 * NÃO simula partidas completas (isso exige login + sala; fica para um passo à parte).
 * O objetivo aqui é achar o teto de conexões/throughput e VER o event-loop lag do
 * servidor sob carga (o sintoma do gargalo de bots).
 *
 * Uso:
 *   node packages/server/scripts/loadtest.mjs                 # local (http://localhost:8080)
 *   TARGET=https://trevalis.fly.dev MODE=both node .../loadtest.mjs
 *   TARGET=... MODE=http HTTP_CONN=100 DURATION=20 HTTP_PATH=/healthz node .../loadtest.mjs
 *   TARGET=... MODE=ws   WS_CONN=300 node .../loadtest.mjs
 *   METRICS_TOKEN=xxx TARGET=... node .../loadtest.mjs         # se o /api/metrics for fechado
 */

const TARGET = (process.env.TARGET ?? 'http://localhost:8080').replace(/\/$/, '');
const MODE = process.env.MODE ?? 'both'; // http | ws | both
const HTTP_CONN = Number(process.env.HTTP_CONN ?? 50);
const DURATION = Number(process.env.DURATION ?? 15);
const HTTP_PATH = process.env.HTTP_PATH ?? '/healthz';
const WS_CONN = Number(process.env.WS_CONN ?? 100);
const WS_HOLD_MS = Number(process.env.WS_HOLD_MS ?? 5000);
const METRICS_TOKEN = process.env.METRICS_TOKEN ?? '';

const wsUrl = TARGET.replace(/^http/, 'ws') + '/ws';
const metricsUrl = TARGET + '/api/metrics' + (METRICS_TOKEN ? `?token=${encodeURIComponent(METRICS_TOKEN)}` : '');

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const round = (n) => Math.round(n * 10) / 10;

async function fetchMetrics(label) {
  try {
    const r = await fetch(metricsUrl);
    if (!r.ok) return console.log(`[metrics ${label}] HTTP ${r.status}`);
    const m = await r.json();
    console.log(`[metrics ${label}]`, JSON.stringify(m));
  } catch (e) {
    console.log(`[metrics ${label}] falhou:`, e.message);
  }
}

async function httpProbe() {
  console.log(`\n== HTTP probe → ${TARGET}${HTTP_PATH} | ${HTTP_CONN} workers × ${DURATION}s ==`);
  const url = TARGET + HTTP_PATH;
  const deadline = Date.now() + DURATION * 1000;
  const lat = [];
  let ok = 0;
  let fail = 0;

  async function worker() {
    while (Date.now() < deadline) {
      const t0 = performance.now();
      try {
        const r = await fetch(url);
        await r.arrayBuffer();
        (r.ok ? (ok++, lat.push(performance.now() - t0)) : fail++);
      } catch {
        fail++;
      }
    }
  }

  const t0 = performance.now();
  await Promise.all(Array.from({ length: HTTP_CONN }, worker));
  const secs = (performance.now() - t0) / 1000;
  const sorted = lat.sort((a, b) => a - b);
  console.log(
    `  ok=${ok} fail=${fail} | ${round(ok / secs)} req/s | latência ms: ` +
      `p50=${round(pct(sorted, 50))} p95=${round(pct(sorted, 95))} max=${round(sorted[sorted.length - 1] ?? 0)}`,
  );
}

function wsProbe() {
  console.log(`\n== WS probe → ${wsUrl} | abrindo ${WS_CONN} conexões ==`);
  if (typeof WebSocket === 'undefined') {
    console.log('  WebSocket global indisponível (precisa de Node >= 22). Pulando.');
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let opened = 0;
    let failed = 0;
    let settled = 0;
    const connectMs = [];
    const sockets = [];
    const t0 = performance.now();

    const finish = () => {
      const sorted = connectMs.sort((a, b) => a - b);
      console.log(
        `  open=${opened} fail=${failed}/${WS_CONN} | conexão ms: ` +
          `p50=${round(pct(sorted, 50))} p95=${round(pct(sorted, 95))} max=${round(sorted[sorted.length - 1] ?? 0)}`,
      );
      for (const s of sockets) { try { s.close(); } catch { /* noop */ } }
      resolve();
    };

    for (let i = 0; i < WS_CONN; i++) {
      const started = performance.now();
      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        failed++; if (++settled === WS_CONN) finish();
        continue;
      }
      sockets.push(ws);
      ws.onopen = () => { opened++; connectMs.push(performance.now() - started); if (++settled === WS_CONN) hold(); };
      ws.onerror = () => { failed++; if (++settled === WS_CONN) hold(); };
    }

    let held = false;
    function hold() {
      if (held) return;
      held = true;
      console.log(`  todas as ${WS_CONN} tentativas resolveram em ${round(performance.now() - t0)}ms; segurando ${WS_HOLD_MS}ms…`);
      setTimeout(finish, WS_HOLD_MS);
    }
    // Rede lenta: garante que não trava para sempre.
    setTimeout(hold, DURATION * 1000 + 10000);
  });
}

async function main() {
  console.log(`Trevalis load test → ${TARGET} (mode=${MODE})`);
  await fetchMetrics('antes');
  if (MODE === 'http' || MODE === 'both') await httpProbe();
  if (MODE === 'ws' || MODE === 'both') await wsProbe();
  await fetchMetrics('depois');
  console.log('\nDica: rode em outro terminal `watch -n1 curl -s .../api/metrics` para ver o event-loop lag ao vivo.');
}

main().catch((e) => { console.error(e); process.exit(1); });
