import { describe, expect, it } from 'vitest';
import { isExpired, RETENTION_MS } from '../src/notifications.js';

describe('isExpired (núcleo puro — janela de 30 dias)', () => {
  const now = new Date('2026-07-09T12:00:00Z');

  it('recém-criada não expirou', () => {
    expect(isExpired(now, now)).toBe(false);
  });

  it('há 29 dias ainda vale', () => {
    const created = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    expect(isExpired(created, now)).toBe(false);
  });

  it('há 31 dias expirou', () => {
    const created = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    expect(isExpired(created, now)).toBe(true);
  });

  it('exatamente na borda dos 30 dias ainda não expirou (> estrito)', () => {
    const created = new Date(now.getTime() - RETENTION_MS);
    expect(isExpired(created, now)).toBe(false);
    expect(isExpired(new Date(created.getTime() - 1), now)).toBe(true);
  });
});
