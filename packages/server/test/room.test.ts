import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESOURCES, type PlayerColor } from '@trevalis/engine';
import type { Difficulty } from '@trevalis/bot';
import { EMPTY_ROOM_TTL_MS, GameRoom, LiveRoom, RECONNECT_GRACE_MS, RoomManager } from '../src/room.js';
import type { RoomConfig } from '../src/protocol.js';

/** userId convencional nos testes: "u-<cor>". */
const uid = (c: PlayerColor): string => `u-${c}`;

function makeConfig(opts: { seed?: number; humans?: PlayerColor[] } = {}): RoomConfig {
  const all: PlayerColor[] = ['red', 'blue', 'white', 'orange'];
  const humans = opts.humans ?? [];
  const bots = all.filter((c) => !humans.includes(c));
  const botDifficulty = Object.fromEntries(all.map((c) => [c, 'medium'])) as Record<PlayerColor, Difficulty>;
  return {
    seed: opts.seed ?? 7,
    boardLayout: 'standard',
    pace: 'normal',
    players: all.map((c, i) => ({ color: c, name: `P${i + 1}`, ...(humans.includes(c) ? { userId: uid(c) } : {}) })),
    bots,
    botDifficulty,
    numberLayout: 'balanced',
    desert: 'random',
    pointsToWin: 10,
    discardLimit: 7,
    friendlyRobber: false,
    balancedDice: false,
  };
}

describe('GameRoom (servidor autoritativo)', () => {
  it('sala so de bots joga sozinha ate o fim', () => {
    const room = new GameRoom('R1', makeConfig());
    expect(room.state.phase).toBe('ended');
    expect(room.state.winner).not.toBeNull();
  });

  it('com 1 humano, a sala para na vez do humano (setup) e o assento e do dono', () => {
    const room = new GameRoom('R2', makeConfig({ humans: ['red'] }));
    expect(room.state.phase).toBe('setup1');
    expect(room.state.currentPlayer).toBe('red');
    expect(room.seat(uid('red'))).toBe('red');
    expect(room.seat('quem-nao-e-jogador')).toBeNull(); // nao e dono de nenhum assento
    expect(room.colorOf(uid('red'))).toBe('red');
  });

  it('bônus de tempo: cada ação produtiva estende o prazo do turno (só do jogador da vez)', () => {
    const room = new GameRoom('RB', makeConfig({ humans: ['red', 'blue'] }));
    // Cenário controlado de fase principal: red com recursos para trocar com o banco.
    room.state.phase = 'main';
    room.state.currentPlayer = 'red';
    room.state.activeTrade = null;
    const red = room.state.players.find((p) => p.color === 'red')!;
    red.hand.wood = 8;
    const base = room.deadlineSeconds()!; // pace normal → 120s, sem bônus ainda

    expect(room.apply('red', { t: 'tradeBank', give: 'wood', want: 'brick' }).ok).toBe(true);
    const after1 = room.deadlineSeconds()!;
    expect(after1).toBe(base + 15);

    expect(room.apply('red', { t: 'tradeBank', give: 'wood', want: 'brick' }).ok).toBe(true);
    expect(room.deadlineSeconds()).toBe(base + 30);

    // O bônus é do jogador da vez: se passar para outra cor, não se aplica.
    room.state.currentPlayer = 'blue';
    expect(room.deadlineSeconds()).toBe(base);
  });

  it('aplica uma acao do humano e segue auto-jogando os bots', () => {
    const room = new GameRoom('R3', makeConfig({ humans: ['red'] }));
    const vid = room.state.board.vertexOrder[0]!;
    const res = room.apply('red', { t: 'placeSettlement', vertexId: vid });
    expect(res.ok).toBe(true);
    // Apos colocar a vila, o engine pede a estrada do mesmo jogador (setup).
    expect(room.state.buildings[vid]?.owner).toBe('red');
  });

  it('rejeita acao ilegal sem mudar o estado', () => {
    const room = new GameRoom('R4', makeConfig({ humans: ['red'] }));
    const before = JSON.stringify(room.state);
    const res = room.apply('red', { t: 'rollDice' }); // nao e fase de rolar
    expect(res.ok).toBe(false);
    expect(JSON.stringify(room.state)).toBe(before);
  });

  it('projeta o estado escondendo a mao dos adversarios (ou de todos, p/ espectador)', () => {
    const room = new GameRoom('R5', makeConfig());
    const view = room.projectedFor('red');
    const opp = view.players.find((p) => p.color !== 'red')!;
    expect(RESOURCES.every((r) => opp.hand[r] === 0)).toBe(true);
    expect(typeof opp.hiddenHand).toBe('number');
    expect(view.rng.seed).toBe(0);

    const spectatorView = room.projectedFor(null);
    expect(spectatorView.players.every((p) => RESOURCES.every((r) => p.hand[r] === 0))).toBe(true);
  });

  it('expoe o limite de tempo da acao humana conforme o ritmo', () => {
    const normal = new GameRoom('T1', makeConfig({ humans: ['red'] }));
    expect(normal.awaitedHuman()).toBe('red');
    expect(normal.deadlineSeconds()).toBe(180); // setup, vila, normal
    const fast = new GameRoom('T2', { ...makeConfig({ humans: ['red'] }), pace: 'fast' });
    expect(fast.deadlineSeconds()).toBe(120); // setup, vila, fast
  });

  it('sem humano aguardando (so bots), nao ha limite de tempo', () => {
    const room = new GameRoom('T3', makeConfig()); // 4 bots -> termina
    expect(room.awaitedHuman()).toBeNull();
    expect(room.deadlineSeconds()).toBeNull();
  });

  it('forceTimeout pilota o humano em atraso (o jogo avanca)', () => {
    const room = new GameRoom('T4', makeConfig({ humans: ['red'] }));
    expect(room.awaitedHuman()).toBe('red');
    const acted = room.forceTimeout();
    expect(acted).toBe(true);
    // O bot colocou a vila (e a estrada) do turno do red em atraso.
    expect(Object.values(room.state.buildings).some((b) => b.owner === 'red')).toBe(true);
  });

  it('desconexao + graca esgotada: a vaga vira bot e o jogo continua sem o humano', () => {
    const room = new GameRoom('T5', makeConfig({ humans: ['red'] }));
    room.seat(uid('red'));
    expect(room.awaitedHuman()).toBe('red');
    room.markDisconnected(uid('red'));
    room.convertToBot(uid('red')); // graca esgotada -> vira bot medio e assume
    expect(room.awaitedHuman()).toBeNull();
    expect(room.state.phase).toBe('ended');
  });

  it('reconexao durante a graca (seat de novo) evita a conversao em bot', () => {
    const room = new GameRoom('T5b', makeConfig({ humans: ['red'] }));
    room.seat(uid('red'));
    room.markDisconnected(uid('red'));
    room.seat(uid('red')); // reconectou antes da graca estourar
    room.convertToBot(uid('red')); // no-op: slot.connected === true agora
    expect(room.awaitedHuman()).toBe('red');
  });

  it('humano AFK nao trava: passa a vez e, apos N timeouts, vira bot ate o fim', () => {
    const room = new GameRoom('T6', makeConfig({ humans: ['red'] }));
    room.seat(uid('red'));
    let guard = 0;
    while (room.state.phase !== 'ended' && guard++ < 100000) {
      if (room.deadlineSeconds() == null) break; // so resolve quando ha janela ativa
      room.forceTimeout();
    }
    expect(room.state.phase).toBe('ended');
    expect(room.state.winner).not.toBeNull();
  });

  it('awayColors reporta assentos humanos hoje pilotados por bot', () => {
    const room = new GameRoom('T7', makeConfig({ humans: ['red', 'blue'] }));
    room.seat(uid('red'));
    room.seat(uid('blue'));
    expect(room.awayColors()).toEqual([]);
    room.markDisconnected(uid('blue'));
    room.convertToBot(uid('blue'));
    expect(room.awayColors()).toEqual(['blue']);
  });
});

describe('LiveRoom (presenca, graca de reconexao, sala vazia)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('conecta senta o dono da vaga e limpa o "vazio desde"', () => {
    const live = new LiveRoom('ABC123');
    live.gameRoom = new GameRoom('ABC123', makeConfig({ humans: ['red'] }));
    expect(live.emptySince).not.toBeNull(); // nasce vazia
    const color = live.connect(uid('red'), 'conn-1');
    expect(color).toBe('red');
    expect(live.hasHuman()).toBe(true);
    expect(live.emptySince).toBeNull();
  });

  it('desconexao agenda a conversao em bot apos a graca (nao instantanea)', () => {
    const live = new LiveRoom('ABC123');
    live.gameRoom = new GameRoom('ABC123', makeConfig({ humans: ['red'] }));
    live.connect(uid('red'), 'conn-1');
    const onExpire = vi.fn();
    live.disconnect(uid('red'), 'conn-1', RECONNECT_GRACE_MS, onExpire);

    // Antes da graca acabar: ainda humano (nao virou bot).
    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
    expect(live.gameRoom.awaitedHuman()).toBe('red');
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(live.gameRoom.awaitedHuman()).toBeNull(); // virou bot e o jogo acabou sozinho
  });

  it('reconectar antes da graca acabar CANCELA a conversao em bot', () => {
    const live = new LiveRoom('ABC123');
    live.gameRoom = new GameRoom('ABC123', makeConfig({ humans: ['red'] }));
    live.connect(uid('red'), 'conn-1');
    const onExpire = vi.fn();
    live.disconnect(uid('red'), 'conn-1', RECONNECT_GRACE_MS, onExpire);
    live.connect(uid('red'), 'conn-2'); // reconectou (outra aba/dispositivo)
    vi.advanceTimersByTime(RECONNECT_GRACE_MS + 10);
    expect(onExpire).not.toHaveBeenCalled();
    expect(live.gameRoom.awaitedHuman()).toBe('red');
  });

  it('desconexao de uma conexao JA SUBSTITUIDA (aba antiga) e ignorada', () => {
    const live = new LiveRoom('ABC123');
    live.gameRoom = new GameRoom('ABC123', makeConfig({ humans: ['red'] }));
    live.connect(uid('red'), 'conn-1');
    live.connect(uid('red'), 'conn-2'); // nova aba assume
    const onExpire = vi.fn();
    live.disconnect(uid('red'), 'conn-1', RECONNECT_GRACE_MS, onExpire); // close tardio da aba antiga
    vi.advanceTimersByTime(RECONNECT_GRACE_MS + 10);
    expect(onExpire).not.toHaveBeenCalled();
    expect(live.hasHuman()).toBe(true); // conn-2 continua valendo
  });

  it('espectador desconectando nao agenda graca nem vira bot', () => {
    const live = new LiveRoom('ABC123');
    live.gameRoom = new GameRoom('ABC123', makeConfig({ humans: ['red'] }));
    live.connect('espectador-1', 'conn-1'); // nao e dono de assento
    const onExpire = vi.fn();
    live.disconnect('espectador-1', 'conn-1', RECONNECT_GRACE_MS, onExpire);
    vi.advanceTimersByTime(RECONNECT_GRACE_MS + 10);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('isEmptyFor: so verdadeiro apos o TTL sem nenhum humano conectado', () => {
    const live = new LiveRoom('ABC123');
    const t0 = Date.now();
    expect(live.isEmptyFor(EMPTY_ROOM_TTL_MS, t0)).toBe(false);
    expect(live.isEmptyFor(EMPTY_ROOM_TTL_MS, t0 + EMPTY_ROOM_TTL_MS)).toBe(true);
  });
});

describe('RoomManager', () => {
  it('cria/recupera salas vivas por code e liga o GameRoom ao iniciar a partida', () => {
    const m = new RoomManager();
    expect(m.get('X1')).toBeUndefined();
    const live = m.getOrCreate('X1');
    expect(m.get('X1')).toBe(live);

    const gameRoom = m.startGame('X1', makeConfig());
    expect(gameRoom.code).toBe('X1');
    expect(m.get('X1')!.gameRoom).toBe(gameRoom);
  });

  it('sweep varre salas vazias ha mais do TTL e chama onExpire', () => {
    vi.useFakeTimers();
    const m = new RoomManager();
    m.getOrCreate('EMPTY1');
    m.getOrCreate('EMPTY2').connect('u1', 'c1'); // esta tem gente: nao deve expirar

    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS + 1000);
    const expired: string[] = [];
    m.sweep(EMPTY_ROOM_TTL_MS, (code) => expired.push(code));
    expect(expired).toEqual(['EMPTY1']);
    vi.useRealTimers();
  });

  it('remove descarta a sala e cancela timers pendentes', () => {
    const m = new RoomManager();
    m.getOrCreate('X2');
    m.remove('X2');
    expect(m.get('X2')).toBeUndefined();
  });
});
