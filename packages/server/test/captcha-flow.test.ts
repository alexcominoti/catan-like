/**
 * Contrato do fluxo de token do Turnstile (Better Auth + Cloudflare).
 *
 * `captcha.test.ts` cobre só o liga/desliga por variável de ambiente. Ele não
 * responde a pergunta que interessa: o plugin realmente barra as rotas certas,
 * lendo o cabeçalho certo? Isso importa porque o CLIENTE tem os dois valores
 * chumbados — `apps/web/src/auth/turnstile.ts` manda `x-captcha-response`, e
 * `Auth.tsx` só desenha o widget nas telas de login/cadastro/esqueci. Se um
 * upgrade do Better Auth mudar o nome do cabeçalho ou a lista padrão de rotas,
 * o captcha vira enfeite (passa todo mundo) ou derruba o cadastro inteiro — e
 * nada no build acusa. Estes testes falham no lugar dos jogadores.
 *
 * A chamada à Cloudflare é dublada: aqui se verifica a NOSSA fiação, não o
 * serviço deles.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { captcha } from 'better-auth/plugins';

/** Resposta do `siteverify` da Cloudflare, no formato que o handler espera. */
function stubSiteVerify(body: Record<string, unknown>, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

const plugin = captcha({ provider: 'cloudflare-turnstile', secretKey: 'segredo-de-teste' });

/** Contexto mínimo que o `onRequest` do plugin consome. */
const ctx = {
  options: { basePath: '/api/auth' },
  logger: { error: () => {} },
} as never;

/**
 * O plugin devolve `undefined` para deixar a requisição seguir, e
 * `{ response }` (não uma `Response` crua) quando barra.
 */
type Resultado = { response: Response } | undefined;

/** Dispara o plugin contra uma rota, com ou sem token. */
async function callRoute(path: string, token?: string): Promise<Resultado> {
  const req = new Request(`https://trevalis.app/api/auth${path}`, {
    method: 'POST',
    headers: token ? { 'x-captcha-response': token } : {},
  });
  return plugin.onRequest?.(req, ctx) as Promise<Resultado>;
}

/** Passou pelo plugin? */
function passou(res: Resultado): boolean {
  return res === undefined;
}

/** Extrai a resposta de bloqueio (falha o teste se o plugin tiver deixado passar). */
function barrado(res: Resultado): Response {
  expect(res, 'o plugin deixou a requisição passar').toBeDefined();
  return res!.response;
}

/** A chamada que o plugin fez ao `siteverify` (falha o teste se não houve nenhuma). */
function chamadaSiteVerify(): { url: string; body: Record<string, unknown> } {
  const call = vi.mocked(fetch).mock.calls[0];
  expect(call, 'o plugin não chamou o siteverify').toBeDefined();
  return {
    url: String(call![0]),
    body: JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>,
  };
}

afterEach(() => vi.unstubAllGlobals());

// As três rotas que o plugin protege por padrão — e que o cliente cobre com o
// widget. Os caminhos vêm do Better Auth; o cadastro/login/reset da SPA batem
// exatamente neles (ver Auth.tsx: signUp.email, signIn.email,
// requestPasswordReset).
const PROTEGIDAS = ['/sign-up/email', '/sign-in/email', '/request-password-reset'];

describe('fluxo do token do Turnstile', () => {
  it.each(PROTEGIDAS)('%s exige token: sem cabeçalho responde 400', async (rota) => {
    stubSiteVerify({ success: true });
    const res = barrado(await callRoute(rota));
    expect(res.status).toBe(400);
    // Não deve nem chegar a falar com a Cloudflare sem token em mãos.
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(PROTEGIDAS)('%s aceita um token válido e segue o fluxo', async (rota) => {
    stubSiteVerify({ success: true });
    expect(passou(await callRoute(rota, 'token-bom'))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(PROTEGIDAS)('%s recusa um token inválido com 403', async (rota) => {
    stubSiteVerify({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(barrado(await callRoute(rota, 'token-forjado')).status).toBe(403);
  });

  it('lê o token do cabeçalho `x-captcha-response` (o que o cliente manda)', async () => {
    stubSiteVerify({ success: true });
    await callRoute('/sign-in/email', 'token-bom');
    expect(chamadaSiteVerify().body).toMatchObject({
      secret: 'segredo-de-teste',
      response: 'token-bom',
    });
  });

  it('bate na URL de verificação da Cloudflare', async () => {
    stubSiteVerify({ success: true });
    await callRoute('/sign-in/email', 'token-bom');
    expect(chamadaSiteVerify().url).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
  });

  /**
   * O motivo de `Auth.tsx` trocar o token depois de TODA tentativa, inclusive a
   * bem-sucedida: reenviar um token já gasto é exatamente este 403. Sem aquele
   * reset, o primeiro login logo após o cadastro cairia aqui.
   */
  it('recusa um token já gasto (`timeout-or-duplicate`)', async () => {
    stubSiteVerify({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    const res = barrado(await callRoute('/sign-in/email', 'token-reaproveitado'));
    expect(res.status).toBe(403);
  });

  it('falha FECHADO se a Cloudflare estiver fora do ar', async () => {
    stubSiteVerify({ erro: 'indisponivel' }, 503);
    const res = barrado(await callRoute('/sign-up/email', 'token-bom'));
    // 500 em vez de deixar passar: indisponibilidade não vira porta aberta.
    expect(res.status).toBe(500);
  });

  it.each(['/sign-out', '/get-session', '/update-user'])(
    'não interfere em %s (rota fora da lista protegida)',
    async (rota) => {
      stubSiteVerify({ success: true });
      expect(passou(await callRoute(rota))).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
