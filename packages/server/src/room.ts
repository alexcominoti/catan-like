import {
  createInitialState,
  projectFor,
  reduce,
  type Action,
  type GameState,
  type PlayerColor,
} from '@hexgame/engine';
import { planBotAction, resolveBotProposal, type Difficulty } from '@hexgame/bot';
import type { Pace, RoomConfig } from './protocol.js';

/** Limites de tempo (segundos) por ritmo, inspirados nos timers do Colonist. */
const PACE_TIMERS: Record<Pace, {
  settlement: number; road: number; dice: number; robber: number; discard: number; turn: number; trade: number;
}> = {
  fast: { settlement: 120, road: 30, dice: 10, robber: 20, discard: 20, turn: 60, trade: 10 },
  normal: { settlement: 180, road: 45, dice: 20, robber: 40, discard: 40, turn: 120, trade: 20 },
};

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

  /** Segundos permitidos para a acao humana atual (ou null se quem age e bot/fim). */
  deadlineSeconds(): number | null {
    const who = this.awaitedHuman();
    if (!who) return null;
    const t = PACE_TIMERS[this.config.pace];
    const s = this.state;
    if (s.activeTrade) return t.trade;
    if (s.phase === 'discard') return t.discard;
    if (s.phase === 'setup1' || s.phase === 'setup2') return s.setupLastVertex ? t.road : t.settlement;
    if (s.phase === 'roll') return t.dice;
    if (s.phase === 'moveBlocker') return t.robber;
    return t.turn; // fase principal: orcamento do turno
  }

  /**
   * Estourou o tempo: resolve a pendencia atual automaticamente. Numa oferta de
   * troca, fecha/cancela (resolveBotProposal); senao, o humano em atraso e
   * "pilotado" por um bot ate a obrigacao dele passar. Retorna se houve acao.
   */
  forceTimeout(): boolean {
    if (this.state.activeTrade) {
      const mv = resolveBotProposal(this.state);
      if (mv) {
        const r = reduce(this.state, mv.by, mv.action);
        if (r.ok) {
          this.state = r.state;
          this.runBots();
          return true;
        }
      }
      return false;
    }
    const awaited = this.awaitedHuman();
    if (!awaited) return false;
    const isBotOrAwaited = (c: PlayerColor): boolean => this.botSet.has(c) || c === awaited;
    let acted = false;
    let guard = 0;
    while (guard++ < 100000 && this.awaitedHuman() === awaited) {
      const move = planBotAction(this.state, isBotOrAwaited, this.difficultyOf);
      if (!move) break;
      const r = reduce(this.state, move.by, move.action);
      if (!r.ok) break;
      this.state = r.state;
      acted = true;
      if (this.state.phase === 'ended') break;
    }
    this.runBots();
    return acted;
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
