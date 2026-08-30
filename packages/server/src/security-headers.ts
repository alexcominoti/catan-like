/**
 * Cabecalhos de seguranca — NUCLEO PURO (monta o mapa; quem aplica e o http.ts).
 *
 * Ate a Fase 1 as respostas saiam so com `content-type`: sem HSTS, sem CSP e
 * sem `frame-ancestors` (ou seja, o site podia ser embutido em iframe por
 * qualquer um — clickjacking).
 *
 * A CSP e montada a partir do que a SPA REALMENTE carrega:
 *  - o bundle e servido pela propria origem (o build do Vite nao gera script
 *    inline nenhum — por isso `script-src 'self'`, sem 'unsafe-inline');
 *  - as fontes vem do Google Fonts (CSS em fonts.googleapis.com, arquivos em
 *    fonts.gstatic.com), declarados no index.html;
 *  - o React aplica estilos via atributo `style`, o que exige 'unsafe-inline'
 *    em style-src (atributo, nao <script>: nao abre porta para XSS de script);
 *  - o jogo fala com o proprio servidor por WebSocket, dai o wss:// da origem
 *    em connect-src (o 'self' cobre isso nos navegadores atuais, mas o explicito
 *    evita surpresa em Safari antigo).
 */

/** Origem WebSocket equivalente a uma URL http(s) — `https://x` vira `wss://x`. */
function wsOrigin(appUrl: string): string | null {
  try {
    const u = new URL(appUrl);
    return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`;
  } catch {
    return null;
  }
}

export interface HeaderOptions {
  /** URL publica do app (base do WebSocket permitido em connect-src). */
  appUrl?: string;
  /** Producao? Fora dela nao mandamos HSTS (quebraria o http://localhost). */
  isProd?: boolean;
  /** Turnstile ligado? Libera o script/iframe do desafio da Cloudflare. */
  captcha?: boolean;
}

/** Monta a Content-Security-Policy. */
export function contentSecurityPolicy(opts: HeaderOptions = {}): string {
  const ws = wsOrigin(opts.appUrl ?? 'http://localhost:8080');
  const turnstile = opts.captcha ? ' https://challenges.cloudflare.com' : '';
  const directives = [
    "default-src 'self'",
    `script-src 'self'${turnstile}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    `connect-src 'self'${ws ? ` ${ws}` : ''}`,
    `frame-src${opts.captcha ? ' https://challenges.cloudflare.com' : " 'none'"}`,
    // Ninguem pode nos embutir em iframe (clickjacking).
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  return directives.join('; ');
}

/**
 * Cabecalhos aplicados a TODA resposta (JSON, estaticos e o fallback da SPA).
 * `Strict-Transport-Security` so em producao: em dev o app roda em http.
 */
export function securityHeaders(opts: HeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'content-security-policy': contentSecurityPolicy(opts),
    // Sem sniffing de tipo: um .txt nunca vira script.
    'x-content-type-options': 'nosniff',
    // Redundante com frame-ancestors, mas cobre navegador antigo.
    'x-frame-options': 'DENY',
    // Nao vaza a URL interna (ex.: /room/CODIGO) para sites de terceiros.
    'referrer-policy': 'strict-origin-when-cross-origin',
    // Nada de camera/microfone/geolocalizacao — o jogo nao usa nada disso.
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
  };
  if (opts.isProd) {
    // 1 ano + subdominios: o navegador passa a recusar http antes de sair.
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}
