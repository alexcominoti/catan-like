import { describe, it, expect, afterEach } from 'vitest';
import { captchaEnabled, turnstileSecretKey, turnstileSiteKey } from '../src/captcha.js';

const ORIGINAL = { site: process.env.TURNSTILE_SITE_KEY, secret: process.env.TURNSTILE_SECRET_KEY };

function setKeys(site?: string, secret?: string): void {
  if (site === undefined) delete process.env.TURNSTILE_SITE_KEY;
  else process.env.TURNSTILE_SITE_KEY = site;
  if (secret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = secret;
}

afterEach(() => setKeys(ORIGINAL.site, ORIGINAL.secret));

describe('captcha (Turnstile)', () => {
  it('fica DESLIGADO sem chaves — o cadastro segue funcionando como antes', () => {
    setKeys(undefined, undefined);
    expect(captchaEnabled()).toBe(false);
    expect(turnstileSiteKey()).toBeNull();
  });

  it('exige as DUAS chaves: só a secreta rejeitaria todo mundo', () => {
    setKeys(undefined, 'segredo');
    expect(captchaEnabled()).toBe(false);
    setKeys('publica', undefined);
    expect(captchaEnabled()).toBe(false);
  });

  it('liga quando as duas estão configuradas', () => {
    setKeys('publica', 'segredo');
    expect(captchaEnabled()).toBe(true);
    expect(turnstileSiteKey()).toBe('publica');
    expect(turnstileSecretKey()).toBe('segredo');
  });

  it('trata string vazia/espaços como ausência de chave', () => {
    setKeys('   ', '  ');
    expect(captchaEnabled()).toBe(false);
  });
});
