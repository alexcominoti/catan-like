import { describe, it, expect } from 'vitest';
import { BUCKETS, RateLimiter, bucketFor, clientIp } from '../src/rate-limit.js';

describe('bucketFor (em que balde cada rota cai)', () => {
  it('não limita estáticos, health check nem /api/auth (que tem o próprio limite)', () => {
    expect(bucketFor('GET', '/')).toBeNull();
    expect(bucketFor('GET', '/assets/app-1a2b3c.js')).toBeNull();
    expect(bucketFor('GET', '/api/health')).toBeNull();
    expect(bucketFor('POST', '/api/auth/sign-in/email')).toBeNull();
  });

  it('separa leitura de escrita', () => {
    expect(bucketFor('GET', '/api/rooms/ABC123')).toBe('read');
    expect(bucketFor('GET', '/api/notifications')).toBe('read');
    expect(bucketFor('POST', '/api/rooms/ABC123/ready')).toBe('write');
    expect(bucketFor('PATCH', '/api/rooms/ABC123')).toBe('write');
  });

  it('aperta as rotas que criam linha no banco ou disparam notificação', () => {
    expect(bucketFor('POST', '/api/rooms')).toBe('expensive');
    expect(bucketFor('POST', '/api/friends/request')).toBe('expensive');
    expect(bucketFor('POST', '/api/invites')).toBe('expensive');
    expect(bucketFor('POST', '/api/reports')).toBe('expensive');
    expect(bucketFor('POST', '/api/matchmaking/join')).toBe('expensive');
    // Enumeração de contas: cara mesmo sendo GET.
    expect(bucketFor('GET', '/api/profile/by-username/alguem')).toBe('expensive');
  });

  it('a listagem do lobby (GET /api/rooms) continua sendo leitura', () => {
    expect(bucketFor('GET', '/api/rooms')).toBe('read');
  });
});

describe('RateLimiter (janela fixa)', () => {
  const bucket = { limit: 3, windowMs: 1000 };

  it('deixa passar até o limite e bloqueia o excedente', () => {
    const rl = new RateLimiter();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rl.check('ip:1.2.3.4', bucket, t).allowed).toBe(true);
    const blocked = rl.check('ip:1.2.3.4', bucket, t);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('libera de novo quando a janela vira', () => {
    const rl = new RateLimiter();
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) rl.check('ip:1.2.3.4', bucket, t);
    expect(rl.check('ip:1.2.3.4', bucket, t + 1001).allowed).toBe(true);
  });

  it('conta cada chave separadamente (um abusador não bloqueia os outros)', () => {
    const rl = new RateLimiter();
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) rl.check('ip:1.1.1.1', bucket, t);
    expect(rl.check('ip:1.1.1.1', bucket, t).allowed).toBe(false);
    expect(rl.check('ip:2.2.2.2', bucket, t).allowed).toBe(true);
  });

  it('descarta janelas vencidas em vez de crescer para sempre', () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 50; i++) rl.check(`ip:10.0.0.${i}`, bucket, 1_000_000);
    expect(rl.size()).toBe(50);
    rl.check('ip:novo', bucket, 1_000_000 + 120_000); // dispara a varredura
    expect(rl.size()).toBe(1);
  });

  it('o balde de leitura cabe uma sala cheia atrás do mesmo IP', () => {
    // Uma aba na sala de espera gasta ~30 leituras/min. Como a chave é o IP,
    // jogadores atrás do mesmo NAT/CGNAT somam — o limite precisa aguentar bem
    // mais que uma mesa inteira sem 429 no meio da partida.
    const rl = new RateLimiter();
    const t = 1_000_000;
    const porJogador = 30;
    const jogadores = 16;
    for (let i = 0; i < porJogador * jogadores; i++) {
      expect(rl.check('read:1.2.3.4', BUCKETS.read, t).allowed).toBe(true);
    }
  });
});

describe('clientIp', () => {
  it('usa o fly-client-ip (o único confiável atrás do proxy do Fly)', () => {
    expect(clientIp({ 'fly-client-ip': '9.9.9.9' }, '172.16.0.1')).toBe('9.9.9.9');
  });

  it('ignora x-forwarded-for, que o cliente pode forjar', () => {
    expect(clientIp({ 'x-forwarded-for': '1.1.1.1' }, '172.16.0.1')).toBe('172.16.0.1');
  });

  it('cai no endereço do socket quando não há header', () => {
    expect(clientIp({}, '203.0.113.5')).toBe('203.0.113.5');
    expect(clientIp({})).toBe('desconhecido');
  });
});
