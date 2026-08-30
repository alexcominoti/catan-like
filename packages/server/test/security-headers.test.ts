import { describe, it, expect } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from '../src/security-headers.js';

describe('securityHeaders', () => {
  it('manda o conjunto que faltava por completo em produção', () => {
    const h = securityHeaders({ appUrl: 'https://trevalis.app', isProd: true });
    expect(h['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['content-security-policy']).toBeDefined();
  });

  it('não manda HSTS fora de produção (quebraria o http://localhost)', () => {
    expect(securityHeaders({ isProd: false })['strict-transport-security']).toBeUndefined();
  });
});

describe('contentSecurityPolicy', () => {
  it('proíbe que o site seja embutido em iframe (clickjacking)', () => {
    expect(contentSecurityPolicy()).toContain("frame-ancestors 'none'");
  });

  it('permite exatamente o que a SPA carrega: bundle próprio e Google Fonts', () => {
    const csp = contentSecurityPolicy({ appUrl: 'https://trevalis.app' });
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
  });

  it('não abre script inline (o build do Vite não gera nenhum)', () => {
    const csp = contentSecurityPolicy();
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('libera o WebSocket da própria origem (é por onde o jogo roda)', () => {
    expect(contentSecurityPolicy({ appUrl: 'https://trevalis.app' })).toContain('wss://trevalis.app');
    expect(contentSecurityPolicy({ appUrl: 'http://localhost:8080' })).toContain('ws://localhost:8080');
  });

  it('só libera a Cloudflare quando o captcha está ligado', () => {
    expect(contentSecurityPolicy({ captcha: false })).not.toContain('challenges.cloudflare.com');
    const comCaptcha = contentSecurityPolicy({ captcha: true });
    expect(comCaptcha).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(comCaptcha).toContain('frame-src https://challenges.cloudflare.com');
  });

  it('aguenta APP_URL inválida sem quebrar a política', () => {
    const csp = contentSecurityPolicy({ appUrl: 'nao-e-url' });
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
