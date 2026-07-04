import { describe, expect, it } from 'vitest';
import { PresenceTracker } from '../src/presence.js';

describe('PresenceTracker', () => {
  it('conta usuários distintos ativos e expira após o TTL', () => {
    const p = new PresenceTracker(60_000);
    const t0 = 1_000_000;
    p.touch('a', null, t0);
    p.touch('b', null, t0);
    p.touch('a', null, t0); // mesmo usuário: não duplica
    expect(p.count(t0)).toBe(2);

    // Dentro do TTL: seguem online.
    expect(p.count(t0 + 59_000)).toBe(2);
    // 'a' renova; 'b' não.
    p.touch('a', null, t0 + 59_000);
    // Passa do TTL desde o último toque de 'b' → só 'a' fica.
    expect(p.count(t0 + 61_000)).toBe(1);
    expect(p.isOnline('a', t0 + 61_000)).toBe(true);
    expect(p.isOnline('b', t0 + 61_000)).toBe(false);
  });

  it('rastreia a sala atual do usuário (para "entrar/assistir")', () => {
    const p = new PresenceTracker(60_000);
    const t0 = 5_000;
    p.touch('a', 'ABC123', t0);
    expect(p.roomOf('a', t0)).toBe('ABC123');
    // Sem sala.
    p.touch('a', null, t0 + 1000);
    expect(p.roomOf('a', t0 + 1000)).toBeNull();
    // Offline → sem sala.
    expect(p.roomOf('a', t0 + 61_001)).toBeNull();
    expect(p.roomOf('desconhecido', t0)).toBeNull();
  });

  it('drop remove o usuário imediatamente', () => {
    const p = new PresenceTracker();
    p.touch('a');
    p.drop('a');
    expect(p.isOnline('a')).toBe(false);
  });
});
