import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/setup.js';
import { robberAllowed } from '../src/rules.js';
import type { PlayerColor } from '../src/types.js';

const twoPlayers = { players: [{ color: 'red', name: 'R' }, { color: 'blue', name: 'B' }] as { color: PlayerColor; name: string }[] };

describe('robberAllowed com ladrão amigável', () => {
  it('o deserto é sempre permitido — não produz, bloqueá-lo é inofensivo', () => {
    const s = createInitialState({ seed: 3, friendlyRobber: true, ...twoPlayers });
    const desert = s.board.hexOrder.find((h) => s.board.hexes[h]!.terrain === 'desert')!;
    // Uma vila de 'blue' (1 PV público, < 3) num canto do deserto.
    const corner = s.board.hexes[desert]!.corners[0]!;
    s.buildings[corner] = { kind: 'settlement', owner: 'blue', vertexId: corner };
    // Mesmo tocando um jogador fraco, mover o ladrão para o deserto vale.
    expect(robberAllowed(s, desert, 'red')).toBe(true);
  });

  it('um hex de RECURSO tocando um jogador fraco continua proibido', () => {
    const s = createInitialState({ seed: 3, friendlyRobber: true, ...twoPlayers });
    const resHex = s.board.hexOrder.find((h) => s.board.hexes[h]!.terrain !== 'desert')!;
    const corner = s.board.hexes[resHex]!.corners[0]!;
    s.buildings[corner] = { kind: 'settlement', owner: 'blue', vertexId: corner };
    expect(robberAllowed(s, resHex, 'red')).toBe(false);
  });

  it('sem ladrão amigável, tudo vale (inclusive o deserto)', () => {
    const s = createInitialState({ seed: 3, ...twoPlayers });
    const desert = s.board.hexOrder.find((h) => s.board.hexes[h]!.terrain === 'desert')!;
    expect(robberAllowed(s, desert, 'red')).toBe(true);
  });
});
