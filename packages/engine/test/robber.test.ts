import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/setup.js';
import { reduce } from '../src/reduce.js';
import { handTotal, robberAllowed, robberVictims } from '../src/rules.js';
import type { GameEvent, GameState, PlayerColor } from '../src/types.js';

const twoPlayers = { players: [{ color: 'red', name: 'R' }, { color: 'blue', name: 'B' }] as { color: PlayerColor; name: string }[] };

/**
 * Monta um estado em `moveBlocker` com 'red' para mover. Coloca uma construcao de
 * cada cor em `owners` num canto DIFERENTE do hex-alvo (ignorando a regra de
 * distancia, valido para um teste de reduce) e da 1 carta a cada dono.
 */
function blockerScenario(
  owners: PlayerColor[],
  opts?: { friendlyRobber?: boolean; scores?: Partial<Record<PlayerColor, number>> },
): { state: GameState; targetHex: string } {
  const players = [
    { color: 'red' as PlayerColor, name: 'R' },
    { color: 'blue' as PlayerColor, name: 'B' },
    { color: 'white' as PlayerColor, name: 'W' },
  ];
  const s = createInitialState({ seed: 42, friendlyRobber: opts?.friendlyRobber, players });
  const targetHex = s.board.hexOrder.find((h) => s.board.hexes[h]!.terrain !== 'desert')!;
  const corners = s.board.hexes[targetHex]!.corners;
  owners.forEach((owner, i) => {
    const vid = corners[i * 2]!; // cantos alternados: nao-adjacentes
    s.buildings[vid] = { kind: 'settlement', owner, vertexId: vid };
    s.players.find((p) => p.color === owner)!.hand.wood = 1;
  });
  // Sob ladrao amigavel, `scores` da PV publicos extras a quem precisa passar do >=3.
  for (const [color, n] of Object.entries(opts?.scores ?? {}) as [PlayerColor, number][]) {
    for (let i = 0; i < n; i++) {
      const free = s.board.vertexOrder.find((v) => !s.buildings[v]);
      if (free) s.buildings[free] = { kind: 'settlement', owner: color, vertexId: free };
    }
  }
  s.blocker = { hexId: s.board.hexOrder.find((h) => h !== targetHex)! };
  s.phase = 'moveBlocker';
  s.currentPlayer = 'red';
  return { state: s, targetHex };
}

const stoleFrom = (events: GameEvent[]): PlayerColor | undefined =>
  events.find((e): e is Extract<GameEvent, { t: 'blockerMoved' }> => e.t === 'blockerMoved')?.stoleFrom;

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

describe('moveBlocker — o servidor é a autoridade do roubo', () => {
  it('rouba do único alvo mesmo quando o cliente NÃO manda stealFrom', () => {
    const { state, targetHex } = blockerScenario(['blue']);
    expect(robberVictims(state, targetHex, 'red')).toEqual(['blue']);
    const r = reduce(state, 'red', { t: 'moveBlocker', hexId: targetHex }); // sem stealFrom
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(stoleFrom(r.events)).toBe('blue');
    expect(handTotal(r.state.players.find((p) => p.color === 'red')!)).toBe(1);
    expect(handTotal(r.state.players.find((p) => p.color === 'blue')!)).toBe(0);
  });

  it('não rouba (e não erra) quando o hex não toca ninguém com cartas', () => {
    const { state, targetHex } = blockerScenario(['blue']);
    state.players.find((p) => p.color === 'blue')!.hand.wood = 0; // sem cartas
    expect(robberVictims(state, targetHex, 'red')).toEqual([]);
    const r = reduce(state, 'red', { t: 'moveBlocker', hexId: targetHex });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(stoleFrom(r.events)).toBeUndefined();
    expect(r.state.blocker.hexId).toBe(targetHex);
  });

  it('com 2+ alvos exige stealFrom válido; rejeita quando falta ou é inválido', () => {
    const { state, targetHex } = blockerScenario(['blue', 'white']);
    expect(robberVictims(state, targetHex, 'red').sort()).toEqual(['blue', 'white']);
    // Falta escolher: rejeita (força o cliente a desambiguar).
    expect(reduce(state, 'red', { t: 'moveBlocker', hexId: targetHex }).ok).toBe(false);
    // Alvo que nem toca o hex: rejeita.
    expect(reduce(state, 'red', { t: 'moveBlocker', hexId: targetHex, stealFrom: 'red' }).ok).toBe(false);
    // Escolha válida: rouba de quem foi escolhido.
    const r = reduce(state, 'red', { t: 'moveBlocker', hexId: targetHex, stealFrom: 'white' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(stoleFrom(r.events)).toBe('white');
  });

  it('ladrão amigável: robberVictims exclui quem tem <3 PV públicos', () => {
    // blue tem só 1 PV (protegido); white recebe PV extra p/ passar de >=3.
    const { state, targetHex } = blockerScenario(['blue', 'white'], {
      friendlyRobber: true,
      scores: { white: 3 },
    });
    expect(robberVictims(state, targetHex, 'red')).toEqual(['white']);
  });

  it('ladrão amigável: rouba automaticamente do único alvo (>=3 PV) via reduce', () => {
    // O hex-alvo toca só blue, que tem PV suficiente — então bloqueá-lo é permitido.
    const { state, targetHex } = blockerScenario(['blue'], {
      friendlyRobber: true,
      scores: { blue: 3 },
    });
    expect(robberVictims(state, targetHex, 'red')).toEqual(['blue']);
    const r = reduce(state, 'red', { t: 'moveBlocker', hexId: targetHex }); // sem stealFrom
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(stoleFrom(r.events)).toBe('blue');
  });
});
