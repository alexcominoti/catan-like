import { describe, it, expect } from 'vitest';
import {
  makeRoomCode,
  nextSeat,
  isListable,
  decideJoin,
  isStaleWaitingRoom,
  STALE_WAITING_ROOM_TTL_MS,
  mapLimit,
  botsOf,
  firstUnreadyName,
  sanitizeRoomConfig,
  seedOf,
  shufflePlayerOrder,
} from '../src/rooms.js';

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

describe('shufflePlayerOrder (ordem de jogo sorteada)', () => {
  const seats = ['host', 'p2', 'p3', 'bot'];

  it('é determinístico: a mesma seed devolve a mesma ordem', () => {
    expect(shufflePlayerOrder(seats, 12345)).toEqual(shufflePlayerOrder(seats, 12345));
  });

  it('preserva todos os jogadores (só permuta)', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect([...shufflePlayerOrder(seats, seed)].sort()).toEqual([...seats].sort());
    }
  });

  it('não deixa o anfitrião sempre em primeiro', () => {
    const firsts = new Set<string>();
    for (let seed = 0; seed < 100; seed++) firsts.add(shufflePlayerOrder(seats, seed)[0]!);
    expect(firsts).toEqual(new Set(seats));
  });

  it('não muta a lista de entrada', () => {
    const input = [...seats];
    shufflePlayerOrder(input, 7);
    expect(input).toEqual(seats);
  });
});

describe('sanitizeRoomConfig (config vinda do cliente)', () => {
  it('mantém as regras legítimas que o cliente envia', () => {
    const c = sanitizeRoomConfig({
      boardLayout: 'large',
      expansion: 'sea',
      pace: 'fast',
      numberLayout: 'random',
      pointsToWin: 12,
      discardLimit: 9,
      friendlyRobber: true,
      balancedDice: true,
    });
    expect(c).toMatchObject({
      boardLayout: 'large',
      expansion: 'sea',
      pace: 'fast',
      numberLayout: 'random',
      pointsToWin: 12,
      discardLimit: 9,
      friendlyRobber: true,
      balancedDice: true,
    });
  });

  it('descarta as flags internas do servidor', () => {
    // `matchmade` fazia a sala entrar na fila do Jogo rápido e receber estranhos;
    // `readyUserIds` pulava o gate de "todos prontos".
    const c = sanitizeRoomConfig({ matchmade: true, readyUserIds: ['outro-usuario'] });
    expect(c.matchmade).toBeUndefined();
    expect(c.readyUserIds).toEqual([]);
  });

  it('descarta chaves desconhecidas', () => {
    const c = sanitizeRoomConfig({ isAdmin: true, qualquerCoisa: 'x' });
    expect(c.isAdmin).toBeUndefined();
    expect(c.qualquerCoisa).toBeUndefined();
  });

  it('limita as regras às mesmas faixas da edição', () => {
    expect(sanitizeRoomConfig({ pointsToWin: 1 }).pointsToWin).toBe(3);
    expect(sanitizeRoomConfig({ pointsToWin: 999 }).pointsToWin).toBe(15);
    expect(sanitizeRoomConfig({ discardLimit: 0 }).discardLimit).toBe(5);
    expect(sanitizeRoomConfig({ discardLimit: 100 }).discardLimit).toBe(15);
  });

  it('normaliza valores inválidos em vez de confiar neles', () => {
    const c = sanitizeRoomConfig({
      boardLayout: '../../etc',
      expansion: 'hacked',
      pace: 'instantaneo',
      numberLayout: 'nenhum',
      desert: 'center', // 'center' só vale no mapa standard
      pointsToWin: 'dez',
      friendlyRobber: 'sim',
    });
    expect(c).toMatchObject({
      boardLayout: 'standard',
      expansion: 'base',
      pace: 'normal',
      numberLayout: 'balanced',
      desert: 'center',
      pointsToWin: 10,
      friendlyRobber: false,
    });
  });

  it('deserto no centro cai fora quando o mapa não é o 3–4', () => {
    expect(sanitizeRoomConfig({ boardLayout: 'large', desert: 'center' }).desert).toBe('random');
  });

  it('aceita a seed do anfitrião, mas só como número', () => {
    expect(sanitizeRoomConfig({ seed: 42 }).seed).toBe(42);
    expect(sanitizeRoomConfig({ seed: 'abc' }).seed).toBeNull();
    expect(sanitizeRoomConfig({}).seed).toBeNull();
  });

  it('valida os bots (cor conhecida, dificuldade conhecida)', () => {
    const c = sanitizeRoomConfig({
      bots: [
        { color: 'blue', name: 'Bot azul', difficulty: 'hard' },
        { color: 'roxo-neon', name: 'Inválido', difficulty: 'medium' },
        { color: 'white', name: 'Sem nível', difficulty: 'impossivel' },
      ],
    });
    expect(c.bots).toEqual([
      { color: 'blue', name: 'Bot azul', difficulty: 'hard' },
      { color: 'white', name: 'Sem nível', difficulty: 'medium' },
    ]);
  });
});

describe('seedOf', () => {
  it('lê a seed do anfitrião e ignora lixo', () => {
    expect(seedOf({ seed: 7 })).toBe(7);
    expect(seedOf({ seed: 'sete' })).toBeNull();
    expect(seedOf({ seed: Infinity })).toBeNull();
    expect(seedOf(null)).toBeNull();
    expect(seedOf({})).toBeNull();
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

describe('isStaleWaitingRoom (expiração de salas inativas — item 6)', () => {
  const TTL = STALE_WAITING_ROOM_TTL_MS;

  it('cria uma sala, simula a inatividade e confirma que ela expira', () => {
    const created = 1_000_000; // "criação" da sala (lastActivityAt inicial)
    const room = { status: 'waiting' as const, lastActivityAt: created };

    // Logo após criar / com heartbeat recente: NÃO expira (fica no lobby).
    expect(isStaleWaitingRoom(room, TTL, created)).toBe(false);
    expect(isStaleWaitingRoom(room, TTL, created + TTL - 1)).toBe(false);

    // Passado o período de inatividade sem heartbeat: expira (será removida).
    expect(isStaleWaitingRoom(room, TTL, created + TTL)).toBe(true);
    expect(isStaleWaitingRoom(room, TTL, created + TTL + 60_000)).toBe(true);
  });

  it('um heartbeat (nova atividade) reinicia a contagem e mantém a sala viva', () => {
    const t0 = 1_000_000;
    const room = { status: 'waiting' as const, lastActivityAt: t0 };
    const now = t0 + TTL + 5_000; // já passou do TTL desde t0
    expect(isStaleWaitingRoom(room, TTL, now)).toBe(true);
    // Heartbeat recente (aba aberta) → lastActivityAt avança → deixa de estar stale.
    expect(isStaleWaitingRoom({ ...room, lastActivityAt: now - 1_000 }, TTL, now)).toBe(false);
  });

  it('só salas waiting expiram assim (in_progress/finished não)', () => {
    const old = { lastActivityAt: 0 };
    expect(isStaleWaitingRoom({ status: 'in_progress', ...old }, TTL, TTL + 1)).toBe(false);
    expect(isStaleWaitingRoom({ status: 'finished', ...old }, TTL, TTL + 1)).toBe(false);
    expect(isStaleWaitingRoom({ status: 'abandoned', ...old }, TTL, TTL + 1)).toBe(false);
    expect(isStaleWaitingRoom({ status: 'waiting', ...old }, TTL, TTL + 1)).toBe(true);
  });
});

describe('mapLimit (mapa -> limite de jogadores)', () => {
  it('mapeia cada mapa ao seu limite; desconhecido cai em 4', () => {
    expect(mapLimit('standard')).toBe(4);
    expect(mapLimit('large')).toBe(6);
    expect(mapLimit('huge')).toBe(8);
    expect(mapLimit('inexistente')).toBe(4);
  });
});

describe('firstUnreadyName (gate de "pronto" para iniciar)', () => {
  const host = { name: 'Ana', isBot: false, isHost: true, isReady: false };
  const bot = { name: 'Bot Rex', isBot: true, isHost: false, isReady: false };

  it('null quando todos os humanos convidados estão prontos', () => {
    expect(firstUnreadyName([host, { name: 'Beto', isBot: false, isHost: false, isReady: true }])).toBeNull();
  });

  it('anfitrião e bots nunca bloqueiam (contam como prontos)', () => {
    // Host não-pronto e bot não-pronto, mas sem convidados humanos pendentes → libera.
    expect(firstUnreadyName([host, bot])).toBeNull();
  });

  it('retorna o nome do 1º convidado humano não-pronto', () => {
    const players = [
      host,
      { name: 'Beto', isBot: false, isHost: false, isReady: true },
      { name: 'Carla', isBot: false, isHost: false, isReady: false },
      { name: 'Dan', isBot: false, isHost: false, isReady: false },
    ];
    expect(firstUnreadyName(players)).toBe('Carla');
  });

  it('sala só de bots (sem convidados) libera o início', () => {
    expect(firstUnreadyName([host, bot, { ...bot, name: 'Bot Zed' }])).toBeNull();
  });
});

describe('botsOf (bots vivos na config da sala)', () => {
  it('lê a lista estruturada {color,name,difficulty}', () => {
    const cfg = { bots: [{ color: 'blue', name: 'Rex', difficulty: 'hard' }] };
    expect(botsOf(cfg)).toEqual([{ color: 'blue', name: 'Rex', difficulty: 'hard' }]);
  });

  it('tolera o formato antigo (só cores) e completa defaults', () => {
    expect(botsOf({ bots: ['white', 'orange'] })).toEqual([
      { color: 'white', name: 'Bot', difficulty: 'medium' },
      { color: 'orange', name: 'Bot', difficulty: 'medium' },
    ]);
  });

  it('descarta cores inválidas e configs sem bots', () => {
    expect(botsOf({ bots: [{ color: 'roxo-neon', name: 'X', difficulty: 'easy' }] })).toEqual([]);
    expect(botsOf({})).toEqual([]);
    expect(botsOf(null)).toEqual([]);
  });
});
