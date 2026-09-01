/**
 * Origens confiáveis — defesa em profundidade contra CSRF e CSWSH.
 *
 * O cookie de sessão é `sameSite: 'lax'`, e o Lax sozinho já barra o caso
 * clássico: um POST disparado de outro site não leva o cookie junto. O problema
 * de depender só dele é ser UMA linha — um `sameSite` afrouxado por engano, uma
 * quirk de navegador ou um subdomínio comprometido e não sobra nada atrás.
 *
 * Aqui fica a segunda linha, e ela vale principalmente para o WEBSOCKET: o
 * `sameSite` NÃO se aplica ao handshake de WebSocket, então sem checar `Origin`
 * qualquer página da web podia abrir um socket autenticado como o jogador
 * (CSWSH) e jogar no lugar dele. Essa porta o Lax nunca fechou.
 *
 * A lista é a mesma que o Better Auth usa para as rotas de conta (era privada
 * em `auth.ts`), para não existirem duas noções de "confiável" que divergem com
 * o tempo.
 *
 * Regra: rejeita quando o `Origin` VEM e não está na lista. Ausente passa —
 * navegador sempre manda `Origin` em POST e no handshake de WebSocket, então
 * "sem Origin" significa cliente que não é navegador (curl, o script de
 * loadtest), e aí não há cookie de terceiro em jogo, que é a única coisa que
 * CSRF explora.
 */

/** Origem pública do app (base para links de e-mail e cookies). */
export function appUrl(): string {
  return process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:8080';
}

/** Origens confiáveis: APP_URL + WEB_ORIGIN + TRUSTED_ORIGINS (CSV). */
export function trustedOrigins(): string[] {
  const set = new Set<string>([appUrl()]);
  if (process.env.WEB_ORIGIN) set.add(process.env.WEB_ORIGIN);
  for (const o of (process.env.TRUSTED_ORIGINS ?? '').split(',')) {
    const t = o.trim();
    if (t) set.add(t);
  }
  // DEV: aceita localhost <-> 127.0.0.1 e as portas comuns do Vite, para nao travar
  // o cadastro/login por causa do host/porta usado no navegador. Producao NAO entra
  // aqui (usa exatamente APP_URL + TRUSTED_ORIGINS).
  if (process.env.NODE_ENV !== 'production') {
    for (const o of [...set]) {
      if (o.includes('://localhost')) set.add(o.replace('://localhost', '://127.0.0.1'));
      else if (o.includes('://127.0.0.1')) set.add(o.replace('://127.0.0.1', '://localhost'));
    }
    for (const port of [5173, 5174, 8080]) {
      set.add(`http://localhost:${port}`);
      set.add(`http://127.0.0.1:${port}`);
    }
  }
  return [...set];
}

/**
 * Compara origens pelo par esquema+host+porta, não pela string crua: `Origin`
 * chega sem barra final, mas `APP_URL` costuma ser escrito com ela.
 */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** `origin` está na lista de confiança? (`null`/ausente = não é navegador.) */
export function isTrustedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  // "null" literal: sandbox de iframe, redirect cross-origin, file://. Nunca confiável.
  if (origin === 'null') return false;
  return trustedOrigins().some((t) => sameOrigin(t, origin));
}

/** Métodos que alteram estado — os únicos que interessam para CSRF. */
const ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A requisição deve ser BARRADA por origem cruzada?
 *
 * Só para métodos de escrita e só quando o `Origin` veio e não confere (ver a
 * nota sobre ausência no topo do arquivo).
 */
export function blockedByOrigin(method: string | undefined, origin: string | undefined): boolean {
  if (!ESCRITA.has((method ?? 'GET').toUpperCase())) return false;
  if (origin === undefined || origin === '') return false;
  return !isTrustedOrigin(origin);
}

/**
 * O handshake de WebSocket pode prosseguir?
 *
 * Mais rígido que o HTTP de propósito: aqui o `sameSite` não protege nada, e
 * todo navegador manda `Origin` no handshake. Ausente continua passando (o
 * script de loadtest e os testes não mandam), mas presente TEM de conferir.
 */
export function wsOriginAllowed(origin: string | undefined): boolean {
  if (origin === undefined || origin === '') return true;
  return isTrustedOrigin(origin);
}
