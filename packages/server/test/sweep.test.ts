import { describe, expect, it, vi } from 'vitest';
import type { WebSocketServer } from 'ws';
import { startServer } from '../src/server.js';
import { RoomManager } from '../src/room.js';

/**
 * Item 6: o servidor precisa varrer periodicamente as salas 'waiting' inativas.
 * Aqui verificamos só a LIGAÇÃO (o sweeper chama a limpeza a cada ciclo). A
 * decisão do que é "inativo" é pura e testada em rooms.test.ts (isStaleWaitingRoom);
 * a remoção real (DELETE no banco) vive em sweepStaleWaitingRooms.
 */
describe('sweeper periódico de salas inativas (item 6)', () => {
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
      await vi.advanceTimersByTimeAsync(30_000); // SWEEP_INTERVAL_MS
      expect(onSweepStaleRooms).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onSweepStaleRooms).toHaveBeenCalledTimes(2);
    } finally {
      wss?.close();
      vi.useRealTimers();
    }
  });
});
