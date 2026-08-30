/**
 * Widget do Cloudflare Turnstile (proteção contra bots no cadastro/login/reset).
 *
 * O servidor decide se o captcha existe: `GET /api/config` devolve a site key
 * (pública) ou `null`. Sem chave, nada disto roda e as telas de conta ficam
 * exatamente como eram — o mesmo comportamento do lado do servidor, onde o
 * plugin só entra quando as duas chaves estão configuradas.
 *
 * O token gerado vai no cabeçalho `x-captcha-response`, que é o que o plugin de
 * captcha do Better Auth espera.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void; theme?: string },
  ) => string;
  reset: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let sitekeyPromise: Promise<string | null> | null = null;

/** Site key configurada no servidor (memoizada; `null` = captcha desligado). */
export function turnstileSiteKey(): Promise<string | null> {
  sitekeyPromise ??= fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { turnstileSiteKey?: string | null } | null) => d?.turnstileSiteKey ?? null)
    .catch(() => null);
  return sitekeyPromise;
}

let scriptPromise: Promise<TurnstileApi | null> | null = null;

/** Carrega o script do Turnstile uma única vez. */
function loadScript(): Promise<TurnstileApi | null> {
  scriptPromise ??= new Promise<TurnstileApi | null>((resolve) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve(window.turnstile ?? null);
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/**
 * Desenha o widget no elemento e devolve como resetá-lo. `onToken` recebe o
 * token a cada resolução (e `null` quando ele expira).
 */
export async function renderTurnstile(
  el: HTMLElement,
  onToken: (token: string | null) => void,
): Promise<{ reset: () => void } | null> {
  const sitekey = await turnstileSiteKey();
  if (!sitekey) return null;
  const api = await loadScript();
  if (!api) return null;
  const id = api.render(el, {
    sitekey,
    callback: (token) => onToken(token),
    'expired-callback': () => onToken(null),
  });
  return { reset: () => api.reset(id) };
}

/** Cabeçalho a mandar junto do cadastro/login/reset (vazio se não há captcha). */
export function captchaHeaders(token: string | null): Record<string, string> {
  return token ? { 'x-captcha-response': token } : {};
}
