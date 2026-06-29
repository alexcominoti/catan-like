import {
  RESOURCES,
  createInitialState,
  projectFor,
  reduce,
  type Action,
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

/**
 * Sala autoritativa: guarda UM GameState e e a unica autoridade sobre as regras.
 * Valida cada acao pelo `reduce` puro, auto-joga os bots e projeta o estado por
 * jogador (fog of war). Sem rede aqui — a camada WebSocket (index.ts) so transporta.
 */
export class GameRoom {
  readonly id: string;
  readonly config: RoomConfig;
  state: GameState;
  /** Assentos humanos: cor + nome + cliente conectado (ou null = vaga aberta). */
  readonly humans: { color: PlayerColor; name: string; clientId: string | null }[];
  private readonly botSet: Set<PlayerColor>;
  /** Turnos seguidos perdidos por tempo, por cor (zera ao agir manualmente). */
  private readonly timeoutStreak = new Map<PlayerColor, number>();

  constructor(id: string, config: RoomConfig) {
    this.id = id;
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
      .map((p) => ({ color: p.color, name: p.name, clientId: null }));
    this.runBots();
  }

  private isBot = (c: PlayerColor): boolean => this.botSet.has(c);
  private difficultyOf = (c: PlayerColor): Difficulty => this.config.botDifficulty[c] ?? 'medium';

  /** Conecta um cliente a uma cor humana livre. Reassume o controle se a vaga virou bot. */
  seat(clientId: string): PlayerColor | null {
    const slot = this.humans.find((h) => h.clientId === null);
    if (!slot) return null;
    slot.clientId = clientId;
    this.botSet.delete(slot.color); // humano reassume o controle (deixa de ser bot)
    this.timeoutStreak.set(slot.color, 0);
    return slot.color;
  }

  /**
   * Desconexao: a vaga vira um BOT MEDIO que assume na hora (o jogo nao trava).
   * Se o jogador voltar, `seat` o devolve ao controle.
   */
  unseat(clientId: string): void {
    const slot = this.humans.find((h) => h.clientId === clientId);
    if (!slot) return;
    slot.clientId = null;
    this.botSet.add(slot.color); // vira bot (dificuldade default = 'medium')
    this.runBots();
  }

  colorOf(clientId: string): PlayerColor | null {
    return this.humans.find((h) => h.clientId === clientId)?.color ?? null;
  }

  /** Aplica uma acao de `by` (so legal pelo reduce) e auto-joga os bots em seguida. */
  apply(by: PlayerColor, action: Action): { ok: boolean; error?: string } {
    const r = reduce(this.state, by, action);
    if (!r.ok) return { ok: false, error: r.error };
    this.state = r.state;
    this.timeoutStreak.set(by, 0); // agiu manualmente: zera o contador de AFK
    this.runBots();
    return { ok: true };
  }

  /** Estado projetado (fog of war) para a visao de uma cor. */
  projectedFor(color: PlayerColor): GameState {
    return projectFor(this.state, color);
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
      if (this.state.phase === 'ended') break;
    }
  }
}

/** Gerencia varias salas por id (em memoria; persistencia fica para a Fase 3). */
export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();

  create(config: RoomConfig): GameRoom {
    let id = makeRoomId();
    while (this.rooms.has(id)) id = makeRoomId();
    const room = new GameRoom(id, config);
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): GameRoom | undefined {
    return this.rooms.get(id);
  }

  remove(id: string): void {
    this.rooms.delete(id);
  }
}

function makeRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
