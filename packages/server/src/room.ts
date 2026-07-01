import {
  RESOURCES,
  createInitialState,
  projectFor,
  projectForSpectator,
  reduce,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerColor,
  type Resource,
} from '@trevalis/engine';
import { planBotAction, type Difficulty } from '@trevalis/bot';
import type { Pace, RoomConfig } from './protocol.js';

/** Limites de tempo (segundos) por ritmo, inspirados nos timers do Colonist. */
const PACE_TIMERS: Record<Pace, {
  settlement: number; road: number; dice: number; robber: number; discard: number; turn: number; trade: number;
}> = {
  fast: { settlement: 120, road: 30, dice: 10, robber: 20, discard: 20, turn: 60, trade: 10 },
  normal: { settlement: 180, road: 45, dice: 20, robber: 40, discard: 40, turn: 120, trade: 20 },
};

/** Turnos consecutivos perdidos por tempo ate a vaga virar bot medio (AFK). */
const MAX_TURN_TIMEOUTS = 3;

/** Segundos de "graca" apos uma desconexao antes de a vaga virar bot medio. */
export const RECONNECT_GRACE_MS = 15_000;

/** Tempo (ms) de sala vazia (sem nenhum humano conectado) ate ser limpa. */
export const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

/**
 * Sala autoritativa: guarda UM GameState e e a unica autoridade sobre as regras.
 * Valida cada acao pelo `reduce` puro, auto-joga os bots e projeta o estado por
 * jogador (fog of war). Sem rede aqui — a camada WebSocket (server.ts) so
 * transporta; a camada de presenca/reconexao (LiveRoom, abaixo) so agenda.
 *
 * Identidade dos assentos = `userId` (conta autenticada), nao mais um id de
 * conexao efemero: como toda sala exige login, isso da reconexao por conta de
 * graca (reabrir o link em outro aparelho com a mesma conta reocupa a vaga).
 */
export class GameRoom {
  readonly code: string;
  readonly config: RoomConfig;
  state: GameState;
  /** Assentos humanos: cor + nome + dono (userId) + conectado agora ou nao. */
  readonly humans: { color: PlayerColor; name: string; userId: string; connected: boolean }[];
  private readonly botSet: Set<PlayerColor>;
  /** Turnos seguidos perdidos por tempo, por cor (zera ao agir manualmente). */
  private readonly timeoutStreak = new Map<PlayerColor, number>();
  /** Eventos acumulados desde o ultimo `drainEvents()` (log/toast/som no cliente). */
  private pendingEvents: GameEvent[] = [];

  constructor(code: string, config: RoomConfig) {
    this.code = code;
    this.config = config;
    this.botSet = new Set(config.bots);
    this.state = createInitialState({
      seed: config.seed,
      boardLayout: config.boardLayout,
      players: config.players,
      numberLayout: config.numberLayout,
      desert: config.desert,
      pointsToWin: config.pointsToWin,
      discardLimit: config.discardLimit,
      friendlyRobber: config.friendlyRobber,
    });
    this.humans = config.players
      .filter((p) => !this.botSet.has(p.color))
      .map((p) => ({ color: p.color, name: p.name, userId: p.userId!, connected: false }));
    this.runBots();
  }

  private isBot = (c: PlayerColor): boolean => this.botSet.has(c);
  private difficultyOf = (c: PlayerColor): Difficulty => this.config.botDifficulty[c] ?? 'medium';

  /** Assentos originalmente humanos que hoje estao sendo pilotados por um bot (AFK/desconectado). */
  awayColors(): PlayerColor[] {
    return this.humans.filter((h) => this.botSet.has(h.color)).map((h) => h.color);
  }

  /** Conecta o dono da vaga (por userId). Reassume o controle se a vaga virou bot. Null = nao e jogador (espectador). */
  seat(userId: string): PlayerColor | null {
    const slot = this.humans.find((h) => h.userId === userId);
    if (!slot) return null;
    slot.connected = true;
    this.botSet.delete(slot.color); // humano reassume o controle (deixa de ser bot)
    this.timeoutStreak.set(slot.color, 0);
    return slot.color;
  }

  /** Desconexao: so marca a vaga como offline. Quem decide QUANDO vira bot e o chamador (grace period). */
  markDisconnected(userId: string): void {
    const slot = this.humans.find((h) => h.userId === userId);
    if (slot) slot.connected = false;
  }

  /** Estourou a graca de reconexao: a vaga vira BOT MEDIO e assume na hora (o jogo nao trava). */
  convertToBot(userId: string): void {
    const slot = this.humans.find((h) => h.userId === userId);
    if (!slot || slot.connected) return; // reconectou entretanto: nao converte
    this.botSet.add(slot.color);
    this.runBots();
  }

  colorOf(userId: string): PlayerColor | null {
    return this.humans.find((h) => h.userId === userId)?.color ?? null;
  }

  /** Esvazia e devolve os eventos acumulados desde a ultima chamada (uma vez por broadcast). */
  drainEvents(): GameEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  /** Aplica uma acao de `by` (so legal pelo reduce) e auto-joga os bots em seguida. */
  apply(by: PlayerColor, action: Action): { ok: boolean; error?: string } {
    const r = reduce(this.state, by, action);
    if (!r.ok) return { ok: false, error: r.error };
    this.state = r.state;
    this.pendingEvents.push(...r.events);
    this.timeoutStreak.set(by, 0); // agiu manualmente: zera o contador de AFK
    this.runBots();
    return { ok: true };
  }

  /** Estado projetado (fog of war) para a visao de uma cor, ou de um espectador (sem cor). */
  projectedFor(color: PlayerColor | null): GameState {
    return color ? projectFor(this.state, color) : projectForSpectator(this.state);
  }

  /** Qual humano (conectado) o jogo esta esperando agora — ou null (bot/fim). */
  awaitedHuman(): PlayerColor | null {
    const s = this.state;
    if (s.phase === 'ended') return null;
    if (s.phase === 'discard') {
      for (const h of this.humans) {
        if (!this.isBot(h.color) && (s.pendingDiscards[h.color] ?? 0) > 0) return h.color;
      }
      return null;
    }
    // Janela de resposta a uma oferta de troca: o proponente (humano) "segura" o turno.
    if (s.activeTrade && !this.isBot(s.activeTrade.from)) return s.activeTrade.from;
    return this.isBot(s.currentPlayer) ? null : s.currentPlayer;
  }

  /** Segundos da janela atual (ou null se quem age e bot/fim de jogo). */
  deadlineSeconds(): number | null {
    const s = this.state;
    if (s.phase === 'ended') return null;
    const t = PACE_TIMERS[this.config.pace];
    if (s.activeTrade) return t.trade; // qualquer oferta ativa tem janela de resposta
    if (!this.awaitedHuman()) return null; // quem age e bot -> sem timer
    if (s.phase === 'discard') return t.discard;
    if (s.phase === 'setup1' || s.phase === 'setup2') return s.setupLastVertex ? t.road : t.settlement;
    if (s.phase === 'roll') return t.dice;
    if (s.phase === 'moveBlocker') return t.robber;
    return t.turn; // fase principal: orcamento do turno
  }

  /**
   * Estourou o LIMITE de tempo da acao atual. Default por situacao (alinhado):
   *  - Oferta de troca pendente: CANCELA.
   *  - Setup: um bot coloca a vila/estrada (uma acao).
   *  - Rolar: rola os dados (NAO joga cavaleiro antes).
   *  - Mover ladrao: move para o DESERTO, sem roubar.
   *  - Descartar (7): descarte ALEATORIO.
   *  - Fase principal: FIM DE TURNO. Apos MAX_TURN_TIMEOUTS seguidos a vaga vira
   *    bot medio (AFK).
   * Retorna se houve acao.
   */
  forceTimeout(): boolean {
    const s = this.state;
    if (s.phase === 'ended') return false;

    // Oferta de troca pendente: cancela (pelo proponente).
    if (s.activeTrade) return this.applyForced(s.activeTrade.from, { t: 'cancelTrade' });

    const who = this.awaitedHuman();
    if (!who) return false;

    if (s.phase === 'discard') {
      return this.applyForced(who, { t: 'discard', resources: this.randomDiscard(who) });
    }
    if (s.phase === 'moveBlocker') {
      return this.applyForced(who, { t: 'moveBlocker', hexId: this.desertOrHarmlessHex() });
    }
    if (s.phase === 'roll') {
      return this.applyForced(who, { t: 'rollDice' }); // sem cavaleiro
    }
    if (s.phase === 'setup1' || s.phase === 'setup2') {
      // Um bot coloca a vila/estrada por ele (uma acao por janela de tempo).
      const isBotOrWho = (c: PlayerColor): boolean => this.botSet.has(c) || c === who;
      const mv = planBotAction(this.state, isBotOrWho, this.difficultyOf);
      return mv ? this.applyForced(mv.by, mv.action) : false;
    }

    // Fase principal: fim de turno; acumula AFK e converte em bot apos N seguidos.
    const streak = (this.timeoutStreak.get(who) ?? 0) + 1;
    this.timeoutStreak.set(who, streak);
    if (streak >= MAX_TURN_TIMEOUTS) {
      this.botSet.add(who); // AFK demais -> vira bot medio
      this.runBots();
      return true;
    }
    return this.applyForced(who, { t: 'endTurn' });
  }

  /** Aplica uma acao "default" (timeout) e segue auto-jogando os bots. */
  private applyForced(by: PlayerColor, action: Action): boolean {
    const r = reduce(this.state, by, action);
    if (!r.ok) return false;
    this.state = r.state;
    this.pendingEvents.push(...r.events);
    this.runBots();
    return true;
  }

  /** n cartas ALEATORIAS da mao do jogador (para o descarte por tempo). */
  private randomDiscard(color: PlayerColor): Partial<Record<Resource, number>> {
    const p = this.state.players.find((pl) => pl.color === color)!;
    const n = this.state.pendingDiscards[color] ?? 0;
    const pool: Resource[] = [];
    for (const r of RESOURCES) for (let i = 0; i < p.hand[r]; i++) pool.push(r);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const out: Partial<Record<Resource, number>> = {};
    for (let i = 0; i < n && i < pool.length; i++) {
      const r = pool[i]!;
      out[r] = (out[r] ?? 0) + 1;
    }
    return out;
  }

  /** Hex para mover o ladrao por tempo: um deserto (senao um hex sem construcoes). */
  private desertOrHarmlessHex(): string {
    const s = this.state;
    const cur = s.blocker.hexId;
    const desert = s.board.hexOrder.find((h) => h !== cur && s.board.hexes[h]!.terrain === 'desert');
    if (desert) return desert;
    const empty = s.board.hexOrder.find(
      (h) => h !== cur && s.board.hexes[h]!.corners.every((v) => !s.buildings[v]),
    );
    return empty ?? s.board.hexOrder.find((h) => h !== cur)!;
  }

  /** Drena as jogadas dos bots ate ser a vez de um humano (ou o fim do jogo). */
  private runBots(): void {
    let guard = 0;
    while (guard++ < 100000) {
      const move = planBotAction(this.state, this.isBot, this.difficultyOf);
      if (!move) break; // nada de bot a fazer agora (vez de humano ou janela de troca)
      const r = reduce(this.state, move.by, move.action);
      if (!r.ok) break; // nao deveria ocorrer; evita laco infinito
      this.state = r.state;
      this.pendingEvents.push(...r.events);
      if (this.state.phase === 'ended') break;
    }
  }
}

/**
 * Sala "viva": rastreia presenca por WebSocket (por userId), independente de o
 * jogo ja ter comecado — cobre reconexao (grace period antes do bot-takeover),
 * heartbeat (o chamador decide o que fazer com sockets mortos) e limpeza de
 * sala vazia (item 6: 5 min sem NENHUM humano conectado).
 */
export class LiveRoom {
  readonly code: string;
  gameRoom: GameRoom | null = null;
  /** userId -> id da conexao WS atual (so uma por usuario; a mais nova vence). */
  private readonly connections = new Map<string, string>();
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Desde quando a sala esta sem NENHUM humano conectado (null = tem gente). */
  emptySince: number | null = Date.now();
  /** Evita notificar o fim de partida mais de uma vez (persistencia externa). */
  finishNotified = false;

  constructor(code: string) {
    this.code = code;
  }

  hasHuman(): boolean {
    return this.connections.size > 0;
  }

  /** Todos os userIds conectados agora (jogadores E espectadores) — para broadcast. */
  connectedUserIds(): string[] {
    return [...this.connections.keys()];
  }

  /** Id da conexao WS atual do usuario (a mais recente), ou undefined se offline. */
  connIdOf(userId: string): string | undefined {
    return this.connections.get(userId);
  }

  /** Nova conexao (ou reconexao) do usuario. Cancela qualquer graca pendente. */
  connect(userId: string, connId: string): PlayerColor | null {
    this.connections.set(userId, connId);
    this.emptySince = null;
    const timer = this.graceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(userId);
    }
    return this.gameRoom?.seat(userId) ?? null;
  }

  /**
   * Conexao caiu. Se o usuario ocupava um assento, agenda a conversao em bot
   * apos `graceMs` (cancelada se ele reconectar antes). `onGraceExpire` deixa o
   * chamador (server.ts) rebroadcastar o estado apos a conversao.
   */
  disconnect(userId: string, connId: string, graceMs: number, onGraceExpire: () => void): void {
    if (this.connections.get(userId) !== connId) return; // conexao antiga (ja substituida): ignora
    this.connections.delete(userId);
    if (this.connections.size === 0) this.emptySince = Date.now();

    this.gameRoom?.markDisconnected(userId);
    if (this.gameRoom?.colorOf(userId) == null) return; // espectador: sem graca/bot

    const timer = setTimeout(() => {
      this.graceTimers.delete(userId);
      this.gameRoom?.convertToBot(userId);
      onGraceExpire();
    }, graceMs);
    this.graceTimers.set(userId, timer);
  }

  /** Ha graca pendente para `nowMs - emptySince >= ttlMs`? (sala elegivel p/ limpeza). */
  isEmptyFor(ttlMs: number, nowMs = Date.now()): boolean {
    return this.emptySince != null && nowMs - this.emptySince >= ttlMs;
  }

  /** Cancela timers pendentes (ao remover a sala do gerenciador). */
  dispose(): void {
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
  }
}

/** Gerencia as salas vivas por `code` (em memoria; persistencia de metadados fica em rooms.ts). */
export class RoomManager {
  private readonly rooms = new Map<string, LiveRoom>();

  getOrCreate(code: string): LiveRoom {
    let room = this.rooms.get(code);
    if (!room) {
      room = new LiveRoom(code);
      this.rooms.set(code, room);
    }
    return room;
  }

  get(code: string): LiveRoom | undefined {
    return this.rooms.get(code);
  }

  /** Cria o GameRoom (motor autoritativo) quando o anfitriao inicia a partida. */
  startGame(code: string, config: RoomConfig): GameRoom {
    const live = this.getOrCreate(code);
    live.gameRoom = new GameRoom(code, config);
    return live.gameRoom;
  }

  remove(code: string): void {
    this.rooms.get(code)?.dispose();
    this.rooms.delete(code);
  }

  /** Varre as salas vazias ha mais de `ttlMs`; `onExpire` decide o que persistir/remover. */
  sweep(ttlMs: number, onExpire: (code: string, room: LiveRoom) => void): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.isEmptyFor(ttlMs, now)) onExpire(code, room);
    }
  }
}
