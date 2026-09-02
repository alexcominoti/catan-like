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
import { captcha } from 'better-auth/plugins';
import { captchaEnabled, turnstileSecretKey } from './captcha.js';
import { appUrl, trustedOrigins } from './origin.js';
import { IP_HEADER } from './rate-limit.js';
import { sanitizeUserUpdate } from './user-update.js';
import { sql } from 'drizzle-orm';
import { getDb, hasDatabase, schema, user as userTable } from '@trevalis/db';
import { sendEmail, actionEmail } from './mailer.js';
import { validateUsername } from './username.js';
import { resolveLang, tr } from './i18n.js';

export type Auth = ReturnType<typeof betterAuth>;

let _auth: Auth | null = null;

// A lista de origens confiaveis mora em `origin.ts`: o Better Auth usa para o
// CSRF das rotas de conta, e o HTTP/WebSocket usam para a checagem de `Origin`.
// Uma definicao so — duas divergiriam com o tempo, e a que ficasse para tras
// viraria o buraco.

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
      // 8 era o piso do aceitavel. O Better Auth so aplica este minimo no
      // CADASTRO, no reset e na troca de senha — nunca no login (conferido em
      // sign-up.mjs, password.mjs e update-user.mjs). Ou seja: subir para 10
      // nao tranca ninguem que ja tem senha de 8; ela vale ate a pessoa trocar.
      minPasswordLength: 10,
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
        update: {
          /**
           * `POST /api/auth/update-user` aceita `name` e os additionalFields com
           * `input: true` — ou seja, dava para gravar `username` direto por ali,
           * pulando a regex de validacao, a checagem de unicidade
           * case-insensitive e a cota de troca UNICA (que so existe em
           * `/api/profile/username`). Como o indice unico e sensivel a
           * maiusculas, dava ate para registrar a variante de capitalizacao do
           * nome de outro jogador.
           *
           * A troca de nome tem uma porta so: a rota do perfil (que escreve
           * direto pelo Drizzle e nao passa por aqui). Aqui a gente fecha as
           * outras — e de quebra sanitiza os campos que sobram.
           */
          before: async (data) => {
            const decision = sanitizeUserUpdate(data as Record<string, unknown>);
            if (!decision.ok) throw new APIError('BAD_REQUEST', { message: decision.error });
            return { data: decision.data };
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
      customRules: {
        // Cadastro e reset criam conta / disparam e-mail: bem mais apertados.
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 5 },
        // Login errado em rajada = tentativa de forca bruta.
        '/sign-in/email': { window: 60, max: 10 },
      },
    },
    // Turnstile no cadastro/login/reset — só entra quando as duas chaves estão
    // configuradas (ver captcha.ts). Sem elas, o fluxo fica como era.
    plugins: captchaEnabled()
      ? [captcha({ provider: 'cloudflare-turnstile', secretKey: turnstileSecretKey()! })]
      : [],
    advanced: {
      useSecureCookies: isProd,
      // O rate limit INTERNO do Better Auth (acima) precisa do IP do cliente, e
      // o padrao dele e `x-forwarded-for` — que atras do Fly NUNCA resolve: o
      // proxy acrescenta o IP real ao que o cliente mandou, e a lib recusa o
      // cabecalho com mais de um valor, justamente porque o primeiro salto e
      // forjavel. Sem IP ela cai num balde unico por rota, e ai um cliente
      // sozinho esgotava o limite de login de TODO mundo (o proprio Better Auth
      // avisa isso no boot). `fly-client-ip` e escrito pelo proxy do Fly e nao
      // da para forjar; e a mesma fonte que o nosso rate limit usa, em
      // rate-limit.ts. Fora do Fly o cabecalho nao existe e a lib cai sozinha em
      // 127.0.0.1 quando NODE_ENV nao e producao.
      ipAddress: { ipAddressHeaders: [IP_HEADER] },
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
