import type { Action, GameEvent, GameState, PlayerColor } from '@trevalis/engine';

/**
 * Cliente WebSocket do jogo — liga a UI ao servidor autoritativo
 * (`@trevalis/server`). Espelha o protocolo sem depender do pacote do servidor
 * (o web nao importa nada dele). Quando ONLINE, a UI envia acoes por aqui e
 * recebe o estado JA projetado (fog of war, ou tudo oculto p/ espectador) em
 * vez de rodar `reduce`/bots localmente.
 *
 * Reconexao: se a conexao cair sem ter sido fechada por nos, tenta de novo com
 * backoff (ate 8s entre tentativas) e reenvia `enter` com o MESMO codigo —
 * como a sala identifica o dono da vaga pela conta (userId, via cookie), o
 * servidor reassenta automaticamente.
 */
/** Uma mensagem de chat da partida. */
export interface ChatMessage {
  from: PlayerColor | null;
  name: string;
  text: string;
  at: number;
}

export type ServerMessage =
  | { t: 'joined'; code: string; color: PlayerColor | null; bots: PlayerColor[] } // color null = espectador
  | { t: 'state'; state: GameState; bots: PlayerColor[]; awayColors: PlayerColor[]; deadlineSeconds: number | null; events: GameEvent[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'error'; error: string };

const MAX_RECONNECT_DELAY_MS = 8000;

export class GameClient {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private code: string | null = null;
  private closedByUser = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Cor do jogador nesta sala, ou null (ainda nao entrou / espectador). */
  color: PlayerColor | null = null;
  connected = false;

  onState?: (state: GameState, bots: PlayerColor[], awayColors: PlayerColor[], deadlineSeconds: number | null, events: GameEvent[]) => void;
  onJoined?: (code: string, color: PlayerColor | null, bots: PlayerColor[]) => void;
  onChat?: (message: ChatMessage) => void;
  onError?: (error: string) => void;
  /** A conexao caiu (a UI pode mostrar "reconectando…"; uma nova tentativa ja foi agendada). */
  onDisconnected?: () => void;
  /** Reconectou com sucesso (o socket abriu de novo; o `enter` foi reenviado). */
  onReconnected?: () => void;

  /** Abre a conexao com o servidor (ex.: ws://localhost:8080 ou wss://...). Resolve no primeiro `open`. */
  connect(url: string): Promise<void> {
    this.url = url;
    this.closedByUser = false;
    return new Promise((resolve, reject) => {
      this.openSocket(resolve, reject);
    });
  }

  /** Entra (ou reentra) na sala pelo codigo — o servidor resolve tudo (config, assento) pela sessao. */
  enter(code: string): void {
    this.code = code;
    this.sendRaw({ t: 'enter', code });
  }

  /** Envia uma acao do jogador (o servidor valida pelo reduce). */
  send(action: Action): void {
    this.sendRaw({ t: 'action', action });
  }

  /**
   * Envia uma SELECAO tentativa (ex.: cartas de descarte ja escolhidas). O
   * servidor apenas a guarda e a usa se o tempo acabar, no lugar do default
   * aleatorio — nao aplica nem responde agora.
   */
  sendSelect(action: Action): void {
    this.sendRaw({ t: 'select', action });
  }

  /** Envia uma mensagem de chat da partida. */
  sendChat(text: string): void {
    this.sendRaw({ t: 'chat', text });
  }

  /** Fecha definitivamente (nao tenta reconectar). */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(onFirstOpen?: () => void, onFirstError?: (e: Error) => void): void {
    const ws = new WebSocket(this.url!);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      const reconnecting = this.reconnectAttempt > 0;
      this.reconnectAttempt = 0;
      if (this.code) this.sendRaw({ t: 'enter', code: this.code });
      if (reconnecting) this.onReconnected?.();
      onFirstOpen?.();
    };
    ws.onerror = () => {
      onFirstError?.(new Error('Falha ao conectar ao servidor.'));
    };
    ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      if (this.closedByUser) return;
      this.onDisconnected?.();
      this.scheduleReconnect();
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'joined') {
        this.color = msg.color;
        this.onJoined?.(msg.code, msg.color, msg.bots);
      } else if (msg.t === 'state') {
        this.onState?.(msg.state, msg.bots, msg.awayColors, msg.deadlineSeconds, msg.events);
      } else if (msg.t === 'chat') {
        this.onChat?.(msg.message);
      } else if (msg.t === 'error') {
        this.onError?.(msg.error);
      }
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private sendRaw(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
