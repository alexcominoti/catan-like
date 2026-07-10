import { describe, expect, it } from 'vitest';
import { planBotAction, type Difficulty } from '@trevalis/bot';
import type { PlayerColor } from '@trevalis/engine';
import { GameRoom } from '../src/room.js';
import { planBotMove } from '../src/bot-pool.js';
import type { RoomConfig } from '../src/protocol.js';

// Sob VITEST o pool roda em modo SÍNCRONO (fallback), então este teste valida a
// reconstrução dados→predicados e a paridade com a chamada direta ao planBotAction.
function freshSetupState() {
  const all: PlayerColor[] = ['red', 'blue', 'white', 'orange'];
  const botDifficulty = Object.fromEntries(all.map((c) => [c, 'medium'])) as Record<PlayerColor, Difficulty>;
  const cfg: RoomConfig = {
    seed: 42,
    boardLayout: 'standard',
    pace: 'normal',
    players: all.map((c, i) => ({ color: c, name: `P${i + 1}`, userId: `u-${c}` })), // todos humanos → sem bots no setup
    bots: [],
    botDifficulty,
    numberLayout: 'balanced',
    desert: 'random',
    pointsToWin: 10,
    discardLimit: 7,
    friendlyRobber: false,
    balancedDice: false,
  };
  const room = new GameRoom('POOL', cfg);
  return { state: room.state, botDifficulty };
}

describe('bot-pool', () => {
  it('planBotMove == planBotAction (mesma jogada; reconstrói isBot/difficulty dos dados)', async () => {
    const { state, botDifficulty } = freshSetupState();
    const cur = state.currentPlayer;

    const direct = planBotAction(state, (c) => c === cur, () => 'medium');
    const viaPool = await planBotMove(state, [cur], botDifficulty);

    expect(viaPool).toEqual(direct);
    expect(viaPool?.action.t).toBe('placeSettlement');
  });

  it('sem bot para agir → null', async () => {
    const { state, botDifficulty } = freshSetupState();
    // Nenhuma cor é bot → não há jogada.
    expect(await planBotMove(state, [], botDifficulty)).toBeNull();
  });
});
