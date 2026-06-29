/**
 * Autenticacao (Better Auth): cadastro, login, logout, recuperacao de senha e
 * confirmacao de e-mail. Sessao por cookie httpOnly assinado; hash de senha com
 * scrypt (padrao moderno do Better Auth); protecao CSRF via `trustedOrigins`;
 * rate limiting embutido no login/endpoints sensiveis.
 *
 * Carga PREGUICOSA: o jogo (hotseat/bots) roda sem banco. `getAuth()` so e
 * construido quando ha `DATABASE_URL` — senao as rotas /api/auth respondem 503.
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb, hasDatabase, schema } from '@trevalis/db';
import { sendEmail, actionEmail } from './mailer.js';

export type Auth = ReturnType<typeof betterAuth>;

let _auth: Auth | null = null;

/** Origem publica do app (para links de e-mail e cookies). */
function appUrl(): string {
  return process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:8080';
}

/** Origens confiaveis (CSRF): APP_URL + WEB_ORIGIN + TRUSTED_ORIGINS (CSV). */
function trustedOrigins(): string[] {
  const set = new Set<string>([appUrl()]);
  if (process.env.WEB_ORIGIN) set.add(process.env.WEB_ORIGIN);
  for (const o of (process.env.TRUSTED_ORIGINS ?? '').split(',')) {
    const t = o.trim();
    if (t) set.add(t);
  }
  return [...set];
}

function buildOptions(): BetterAuthOptions {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    appName: 'Trevalis',
    baseURL: appUrl(),
    secret: process.env.BETTER_AUTH_SECRET ?? process.env.SERVER_SECRET,
    trustedOrigins: trustedOrigins(),
    database: drizzleAdapter(getDb(), { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
      sendResetPassword: async ({ user, url }) => {
        const { html, text } = actionEmail(
          'Redefinir sua senha',
          'Recebemos um pedido para redefinir a senha da sua conta Trevalis.',
          'Redefinir senha',
          url,
        );
        await sendEmail({ to: user.email, subject: 'Redefinir senha — Trevalis', html, text });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const { html, text } = actionEmail(
          'Confirme seu e-mail',
          'Bem-vindo ao Trevalis! Confirme seu e-mail para ativar a conta.',
          'Confirmar e-mail',
          url,
        );
        await sendEmail({ to: user.email, subject: 'Confirme seu e-mail — Trevalis', html, text });
      },
    },
    user: {
      additionalFields: {
        // username unico escolhido pelo jogador (coluna ja existe no schema).
        username: { type: 'string', required: false, input: true },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 dias
      updateAge: 60 * 60 * 24, // renova a cada 1 dia de uso
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30, // por janela; o Better Auth aplica limites menores no login
    },
    advanced: {
      useSecureCookies: isProd,
      defaultCookieAttributes: { sameSite: 'lax' },
      // Cookie compartilhado entre apex e www (ex.: COOKIE_DOMAIN=.trevalis.app),
      // para a sessao valer em https://trevalis.app E https://www.trevalis.app.
      ...(process.env.COOKIE_DOMAIN
        ? { crossSubDomainCookies: { enabled: true, domain: process.env.COOKIE_DOMAIN } }
        : {}),
    },
  };
}

/** Retorna (e memoiza) a instancia de auth, ou `null` se nao ha banco. */
export function getAuth(): Auth | null {
  if (_auth) return _auth;
  if (!hasDatabase()) return null;
  _auth = betterAuth(buildOptions());
  return _auth;
}
