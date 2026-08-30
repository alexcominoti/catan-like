/**
 * Proteção contra bots no cadastro/login/reset (Cloudflare Turnstile).
 *
 * Sem isto, criar contas em massa custa nada ao atacante e custa a nos: cada
 * cadastro dispara um e-mail pelo Resend e grava linhas no banco. O limite por
 * IP da Fase 0 ajuda, mas nao resolve — botnet troca de IP.
 *
 * LIGA SOZINHO quando as chaves existem. Sem `TURNSTILE_SECRET_KEY` o plugin do
 * Better Auth nem entra na configuracao e o fluxo fica exatamente como era —
 * senao, com o plugin ligado e o cliente sem widget, TODO cadastro passaria a
 * responder 400 ("missing captcha response"). Falha aberta e proposital aqui: a
 * alternativa (derrubar o cadastro de todo mundo por falta de config) e pior.
 *
 * Para ligar em producao:
 *   1. Cloudflare > Turnstile > adicionar site (dominio trevalis.app);
 *   2. `fly secrets set TURNSTILE_SITE_KEY=... TURNSTILE_SECRET_KEY=...`.
 * A site key e PUBLICA (vai para o navegador, exposta em GET /api/config); so a
 * secret key e segredo.
 */

/** Chave publica do widget (vai para o cliente). `null` = captcha desligado. */
export function turnstileSiteKey(): string | null {
  const k = process.env.TURNSTILE_SITE_KEY?.trim();
  return k ? k : null;
}

/** Chave secreta (validacao servidor-a-servidor com a Cloudflare). */
export function turnstileSecretKey(): string | null {
  const k = process.env.TURNSTILE_SECRET_KEY?.trim();
  return k ? k : null;
}

/**
 * Captcha ativo? Exige as DUAS chaves: sem a publica o cliente nao consegue
 * gerar o token, e o servidor rejeitaria todo mundo.
 */
export function captchaEnabled(): boolean {
  return turnstileSiteKey() !== null && turnstileSecretKey() !== null;
}
