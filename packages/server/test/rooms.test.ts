import { describe, it, expect } from 'vitest';
import { makeRoomCode, nextSeat, isListable, decideJoin } from '../src/rooms.js';

describe('makeRoomCode', () => {
  it('gera um código de 6 caracteres do alfabeto seguro (sem I/O/0/1)', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('é determinístico com um gerador injetado', () => {
    const seq = [0, 0.5, 0.99, 0.1, 0.2, 0.3];
    let i = 0;
    const rand = () => seq[i++ % seq.length]!;
    expect(makeRoomCode(rand)).toHaveLength(6);
  });
});

describe('nextSeat', () => {
  it('escolhe a primeira cor livre na ordem do engine', () => {
    expect(nextSeat([])).toEqual({ color: 'red', seatIndex: 0 });
    expect(nextSeat(['red'])).toEqual({ color: 'blue', seatIndex: 1 });
    expect(nextSeat(['red', 'blue', 'white'])).toEqual({ color: 'orange', seatIndex: 3 });
  });

  it('retorna null quando todas as cores estão ocupadas', () => {
    const all = ['red', 'blue', 'white', 'orange', 'green', 'brown', 'purple', 'pink'] as const;
    expect(nextSeat(all)).toBeNull();
  });
});

describe('isListable', () => {
  it('lista apenas salas aguardando jogadores e não privadas', () => {
    expect(isListable({ status: 'waiting', isPrivate: false })).toBe(true);
    expect(isListable({ status: 'waiting', isPrivate: true })).toBe(false);
    expect(isListable({ status: 'in_progress', isPrivate: false })).toBe(false);
    expect(isListable({ status: 'finished', isPrivate: false })).toBe(false);
  });
});

describe('decideJoin (entrar via link / lobby)', () => {
  it('permite entrar numa sala aguardando com vaga', () => {
    expect(decideJoin({ status: 'waiting', current: 2, max: 4 }, false)).toEqual({ ok: true });
  });

  it('bloqueia com "Sala cheia." quando lotada', () => {
    const r = decideJoin({ status: 'waiting', current: 4, max: 4 }, false);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Sala cheia.');
    expect(r.httpStatus).toBe(409);
  });

  it('bloqueia quando a partida já começou', () => {
    const r = decideJoin({ status: 'in_progress', current: 1, max: 4 }, false);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('A partida já começou.');
  });

  it('é idempotente para quem já é membro (mesmo cheia ou em andamento)', () => {
    expect(decideJoin({ status: 'waiting', current: 4, max: 4 }, true)).toEqual({ ok: true });
    expect(decideJoin({ status: 'in_progress', current: 4, max: 4 }, true)).toEqual({ ok: true });
  });
});
