/**
 * Checagem de `Origin` (CSRF/CSWSH) — ver `src/origin.ts`.
 *
 * O que estes testes protegem: a regra é "barra quando o Origin VEIO e não
 * confere; ausente passa". É fácil alguém endurecer isso depois para "exige
 * Origin sempre" e derrubar o script de loadtest e os clientes que não são
 * navegador — ou afrouxar para "passa sempre" e reabrir o CSWSH. Os dois lados
 * estão fixados aqui.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { blockedByOrigin, isTrustedOrigin, wsOriginAllowed, trustedOrigins } from '../src/origin.js';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.NODE_ENV = 'production'; // sem os atalhos de dev
  process.env.APP_URL = 'https://trevalis.app';
  process.env.TRUSTED_ORIGINS = 'https://www.trevalis.app';
  delete process.env.WEB_ORIGIN;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('origens confiáveis', () => {
  it('reúne APP_URL + TRUSTED_ORIGINS', () => {
    expect(trustedOrigins()).toEqual(['https://trevalis.app', 'https://www.trevalis.app']);
  });

  it('compara por esquema+host+porta, não pela string crua', () => {
    // `Origin` nunca traz barra final; `APP_URL` quase sempre é escrito com ela.
    process.env.APP_URL = 'https://trevalis.app/';
    expect(isTrustedOrigin('https://trevalis.app')).toBe(true);
  });

  it('não confunde host parecido nem esquema trocado', () => {
    expect(isTrustedOrigin('https://trevalis.app.evil.com')).toBe(false);
    expect(isTrustedOrigin('https://trevalisxapp')).toBe(false);
    expect(isTrustedOrigin('http://trevalis.app')).toBe(false); // http != https
  });

  it('recusa a origem opaca "null" (iframe sandbox, file://)', () => {
    expect(isTrustedOrigin('null')).toBe(false);
  });

  it('em produção NÃO libera localhost', () => {
    expect(isTrustedOrigin('http://localhost:5173')).toBe(false);
  });

  it('fora de produção libera localhost e 127.0.0.1 (senão o dev trava)', () => {
    process.env.NODE_ENV = 'development';
    expect(isTrustedOrigin('http://localhost:5173')).toBe(true);
    expect(isTrustedOrigin('http://127.0.0.1:5173')).toBe(true);
  });
});

describe('HTTP: bloqueio por origem cruzada', () => {
  it('barra escrita vinda de outro site', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(blockedByOrigin(m, 'https://evil.com')).toBe(true);
    }
  });

  it('deixa passar escrita da própria origem', () => {
    expect(blockedByOrigin('POST', 'https://trevalis.app')).toBe(false);
    expect(blockedByOrigin('POST', 'https://www.trevalis.app')).toBe(false);
  });

  it('não mexe em leitura — GET/HEAD passam mesmo de fora', () => {
    // GET não é alvo de CSRF aqui (nada muda de estado) e barrar quebraria
    // link/imagem legítimos.
    expect(blockedByOrigin('GET', 'https://evil.com')).toBe(false);
    expect(blockedByOrigin('HEAD', 'https://evil.com')).toBe(false);
  });

  it('sem Origin passa: não é navegador, logo não há cookie de terceiro', () => {
    expect(blockedByOrigin('POST', undefined)).toBe(false);
    expect(blockedByOrigin('POST', '')).toBe(false);
  });

  it('trata o método em minúsculas', () => {
    expect(blockedByOrigin('post', 'https://evil.com')).toBe(true);
  });
});

describe('WebSocket: handshake', () => {
  it('recusa handshake de outro site (CSWSH — o Lax não cobre isto)', () => {
    expect(wsOriginAllowed('https://evil.com')).toBe(false);
    expect(wsOriginAllowed('null')).toBe(false);
  });

  it('aceita handshake da própria origem', () => {
    expect(wsOriginAllowed('https://trevalis.app')).toBe(true);
  });

  it('aceita cliente sem Origin (loadtest, testes, cliente nativo)', () => {
    expect(wsOriginAllowed(undefined)).toBe(true);
  });
});
