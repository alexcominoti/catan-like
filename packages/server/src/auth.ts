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
import { APIError } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import { getDb, hasDatabase, schema, user as userTable } from '@trevalis/db';
import { sendEmail, actionEmail } from './mailer.js';
import { validateUsername } from './username.js';
import { resolveLang, tr } from './i18n.js';

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

/**
 * Username já em uso (case-insensitive)? Opcionalmente ignora um userId (para a
 * troca de username no perfil, onde o próprio usuário não conta como conflito).
 */
export async function isUsernameTaken(name: string, excludeUserId?: string): Promise<boolean> {
  const db = getDb();
  const where = excludeUserId
    ? sql`lower(${userTable.username}) = lower(${name}) and ${userTable.id} <> ${excludeUserId}`
    : sql`lower(${userTable.username}) = lower(${name})`;
  const rows = await db.select({ id: userTable.id }).from(userTable).where(where).limit(1);
  return rows.length > 0;
}

/** E-mail já cadastrado (case-insensitive)? Para mensagem clara no cadastro. */
export async function isEmailTaken(email: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(sql`lower(${userTable.email}) = lower(${email})`)
    .limit(1);
  return rows.length > 0;
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
        const lang = resolveLang({ user: user as { language?: string | null } });
        const { html, text } = actionEmail(
          lang,
          tr(lang, 'email.reset.title'),
          tr(lang, 'email.reset.intro'),
          tr(lang, 'email.reset.cta'),
          url,
        );
        await sendEmail({ to: user.email, subject: tr(lang, 'email.reset.subject'), html, text });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const lang = resolveLang({ user: user as { language?: string | null } });
        const { html, text } = actionEmail(
          lang,
          tr(lang, 'email.verify.title'),
          tr(lang, 'email.verify.intro'),
          tr(lang, 'email.verify.cta'),
          url,
        );
        await sendEmail({ to: user.email, subject: tr(lang, 'email.verify.subject'), html, text });
      },
    },
    user: {
      additionalFields: {
        // username unico escolhido pelo jogador (coluna ja existe no schema).
        username: { type: 'string', required: false, input: true },
        // cota de troca de username já usada? (somente leitura para o cliente).
        usernameChanged: { type: 'boolean', required: false, input: false },
        // idioma preferido (pt-BR | en) — o cliente envia no cadastro; usado nos e-mails.
        language: { type: 'string', required: false, input: true },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // No cadastro, o campo "Nome" É o username: validamos a regex e a
          // unicidade ANTES de criar a conta (mensagens claras em vez de erro
          // bruto do índice único). Ver apps/web/src/site/Auth.tsx.
          before: async (u) => {
            const lang = resolveLang({ user: u as { language?: string | null } });
            const name = (u.name ?? '').trim();
            const err = validateUsername(name);
            if (err) throw new APIError('BAD_REQUEST', { message: err });
            if (await isUsernameTaken(name)) {
              throw new APIError('BAD_REQUEST', { message: tr(lang, 'account.usernameTaken') });
            }
            // E-mail único com mensagem clara (em vez do erro bruto do índice).
            if (u.email && (await isEmailTaken(u.email))) {
              throw new APIError('BAD_REQUEST', { message: tr(lang, 'account.emailTaken') });
            }
            return { data: { ...u, name, username: name } };
          },
        },
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
