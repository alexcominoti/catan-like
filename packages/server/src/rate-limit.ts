/**
 * Rate limit das rotas HTTP — NUCLEO PURO (janela fixa em memoria).
 *
 * Por que importa aqui: cada rota de API toca o Postgres, e a cota de
 * compute-hours do Neon e o teto real da producao. Sem limite, um laco simples
 * em `POST /api/rooms` queima a cota e derruba junto o login e o reset de senha
 * — sem precisar de nenhuma intencao maliciosa sofisticada.
 *
 * Janela fixa e o suficiente: rodamos em UMA maquina (estado em memoria basta) e
 * o objetivo e cortar abuso automatizado, nao policiar rajadas de 1 segundo.
 * `/api/auth/*` NAO passa por aqui — o Better Auth ja tem o proprio limitador,
 * com regras mais espertas para login/reset.
 */

/** Um balde: quantas requisicoes cabem numa janela de quantos ms. */
export interface Bucket {
  limit: number;
  windowMs: number;
}

/**
 * Baldes por tipo de rota, dimensionados pelo uso REAL do cliente.
 *
 * Uma aba na sala de espera gasta ~30 leituras/min (a sala a cada 2,5s + as
 * notificacoes a cada 20s); o lobby, ~33. Como a chave e o IP, jogadores atras
 * do mesmo NAT — um escritorio, ou o CGNAT de uma operadora movel — SOMAM no
 * mesmo balde: 600/min deixa ~20 jogadores simultaneos por IP antes de esbarrar
 * e ainda corta qualquer script (que faz milhares por minuto).
 *
 * Escrita e mais rara, mas o anfitriao mexendo nos sliders gera rajadas (um
 * patch a cada 400ms), dai os 180/min. As rotas "caras" — as que criam linha no
 * banco ou disparam e-mail/notificacao — sao as mais apertadas, e nenhum uso
 * humano chega perto de 20/min.
 */
export const BUCKETS = {
  read: { limit: 600, windowMs: 60_000 },
  write: { limit: 180, windowMs: 60_000 },
  expensive: { limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, Bucket>;

export type BucketName = keyof typeof BUCKETS;

/** Rotas que criam linha no banco, disparam e-mail/notificacao ou varrem tabelas. */
const EXPENSIVE_PATHS = new Set([
  '/api/rooms', // POST: cria sala
  '/api/friends/request',
  '/api/invites',
  '/api/reports',
  '/api/matchmaking/join',
]);

/**
 * Em qual balde uma requisicao cai. `null` = nao limitar (estaticos da SPA,
 * health check e `/api/auth/*`, que tem o limitador do Better Auth).
 */
export function bucketFor(method: string, path: string): BucketName | null {
  if (!path.startsWith('/api/')) return null;
  if (path.startsWith('/api/auth')) return null;
  if (path === '/api/health') return null;
  const write = method !== 'GET' && method !== 'HEAD';
  if (write && EXPENSIVE_PATHS.has(path)) return 'expensive';
  if (path.startsWith('/api/profile/by-username/')) return 'expensive'; // enumeracao de contas
  return write ? 'write' : 'read';
}

export interface Decision {
  allowed: boolean;
  /** Segundos ate a janela virar (para o header `retry-after`). */
  retryAfterSec: number;
}

/**
 * Contador de janela fixa. Guarda `{ count, resetAt }` por chave e limpa as
 * entradas vencidas de tempos em tempos (sem timer: a limpeza pega carona nas
 * proprias chamadas, entao um servidor ocioso nao faz nada).
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  /** Registra uma requisicao e diz se ela pode passar. */
  check(key: string, bucket: Bucket, now = Date.now()): Decision {
    this.sweep(now);
    const cur = this.hits.get(key);
    if (!cur || now >= cur.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + bucket.windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    cur.count += 1;
    if (cur.count > bucket.limit) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  /** Descarta janelas vencidas (no maximo uma varredura por minuto). */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, v] of this.hits) {
      if (now >= v.resetAt) this.hits.delete(k);
    }
  }

  /** Quantas chaves estao sendo rastreadas (diagnostico/teste). */
  size(): number {
    return this.hits.size;
  }

  /** Zera tudo (testes). */
  reset(): void {
    this.hits.clear();
    this.lastSweep = 0;
  }
}

/**
 * IP do cliente. Atras do proxy do Fly o valor confiavel e `fly-client-ip` — o
 * `x-forwarded-for` cru NAO serve, porque o proprio cliente pode forjar o
 * primeiro salto e escapar do limite trocando de "IP" a cada requisicao.
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddr?: string,
): string {
  const fly = headers['fly-client-ip'];
  const ip = Array.isArray(fly) ? fly[0] : fly;
  return (ip ?? socketAddr ?? 'desconhecido').trim();
}
