import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketServer } from 'ws';
import { startServer } from '../src/server.js';
import { RoomManager } from '../src/room.js';
import { armRoomSweep, noteRoomSweepDone, resetDbIdleSignals, roomSweepArmed } from '../src/db-idle.js';
import { STALE_WAITING_ROOM_TTL_MS } from '../src/rooms.js';

const STALE_SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Item 6: o servidor precisa varrer periodicamente as salas 'waiting' inativas.
 * Aqui verificamos só a LIGAÇÃO (o sweeper chama a limpeza) e o gate de
 * ociosidade. A decisão do que é "inativo" é pura e testada em rooms.test.ts
 * (isStaleWaitingRoom); a remoção real (DELETE no banco) vive em
 * sweepStaleWaitingRooms.
 */
describe('sweeper periódico de salas inativas (item 6)', () => {
  beforeEach(() => resetDbIdleSignals());

  it('invoca onSweepStaleRooms a cada ciclo de varredura', async () => {
    vi.useFakeTimers();
    let wss: WebSocketServer | null = null;
    try {
      const onSweepStaleRooms = vi.fn(async () => [] as string[]);
      wss = startServer(0, {
        manager: new RoomManager(),
        resolveUserId: async () => null,
        roomExists: async () => false,
        onSweepStaleRooms,
      });

      expect(onSweepStaleRooms).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(STALE_SWEEP_INTERVAL_MS);
      expect(onSweepStaleRooms).toHaveBeenCalledTimes(1);

      // Sala nova mantém o sweeper armado: o ciclo seguinte volta a varrer.
      armRoomSweep();
      await vi.advanceTimersByTimeAsync(STALE_SWEEP_INTERVAL_MS);
      expect(onSweepStaleRooms).toHaveBeenCalledTimes(2);
    } finally {
      wss?.close();
      vi.useRealTimers();
    }
  });

  it('para de varrer quando não há mais sala que possa vencer o TTL', async () => {
    vi.useFakeTimers();
    let wss: WebSocketServer | null = null;
    try {
      const onSweepStaleRooms = vi.fn(async () => [] as string[]);
      wss = startServer(0, {
        manager: new RoomManager(),
        resolveUserId: async () => null,
        roomExists: async () => false,
        onSweepStaleRooms,
      });

      // A passada de boot roda e, como nada foi criado desde então, desarma:
      // daí em diante o servidor ocioso não encosta mais no banco.
      await vi.advanceTimersByTimeAsync(STALE_WAITING_ROOM_TTL_MS + STALE_SWEEP_INTERVAL_MS);
      const afterBoot = onSweepStaleRooms.mock.calls.length;
      expect(afterBoot).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(STALE_SWEEP_INTERVAL_MS * 10);
      expect(onSweepStaleRooms).toHaveBeenCalledTimes(afterBoot);
    } finally {
      wss?.close();
      vi.useRealTimers();
    }
  });
});

describe('sinais de ociosidade do banco (db-idle)', () => {
  beforeEach(() => resetDbIdleSignals());

  it('nasce armado no boot (recupera salas de antes do restart)', () => {
    expect(roomSweepArmed()).toBe(true);
  });

  it('só desarma quando a última atividade já venceu o TTL', () => {
    const t0 = 1_000_000;
    armRoomSweep(t0);

    noteRoomSweepDone(STALE_WAITING_ROOM_TTL_MS, t0 + STALE_WAITING_ROOM_TTL_MS - 1);
    expect(roomSweepArmed()).toBe(true); // a sala ainda pode estar viva

    noteRoomSweepDone(STALE_WAITING_ROOM_TTL_MS, t0 + STALE_WAITING_ROOM_TTL_MS);
    expect(roomSweepArmed()).toBe(false); // tudo que podia expirar já foi removido
  });

  it('sala nova rearma um sweeper já desarmado', () => {
    const t0 = 1_000_000;
    armRoomSweep(t0);
    noteRoomSweepDone(STALE_WAITING_ROOM_TTL_MS, t0 + STALE_WAITING_ROOM_TTL_MS);
    expect(roomSweepArmed()).toBe(false);

    armRoomSweep(t0 + STALE_WAITING_ROOM_TTL_MS);
    expect(roomSweepArmed()).toBe(true);
  });
});
