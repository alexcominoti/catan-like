import {
  createInitialState,
  projectFor,
  reduce,
  type Action,
  type GameState,
  type PlayerColor,
} from '@hexgame/engine';
import { planBotAction, type Difficulty } from '@hexgame/bot';
import type { RoomConfig } from './protocol.js';

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

  /** Conecta um cliente a uma cor humana livre. Retorna a cor, ou null se lotado. */
  seat(clientId: string): PlayerColor | null {
    const slot = this.humans.find((h) => h.clientId === null);
    if (!slot) return null;
    slot.clientId = clientId;
    return slot.color;
  }

  /** Libera o assento de um cliente (desconexao). */
  unseat(clientId: string): void {
    const slot = this.humans.find((h) => h.clientId === clientId);
    if (slot) slot.clientId = null;
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
