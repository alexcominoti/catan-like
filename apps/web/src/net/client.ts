import type { Action, GameState, PlayerColor } from '@trevalis/engine';
import type { GameConfig } from '../ui/Lobby.js';

/**
 * Cliente WebSocket do jogo (Fase 2). Espelha o protocolo de `@trevalis/server`
 * sem depender dele (o web nao importa o pacote do servidor). A UI usa isto para,
 * quando ONLINE, enviar acoes ao servidor e receber o estado JA projetado
 * (fog of war) em vez de rodar o `reduce`/bots localmente.
 *
 * NOTA: ainda nao ligado ao Game.tsx — e a base para o passo 3 da Fase 2.
 */
export type ServerMessage =
  | { t: 'joined'; roomId: string; color: PlayerColor }
  | { t: 'state'; state: GameState }
  | { t: 'error'; error: string };

export class GameClient {
  private ws: WebSocket | null = null;
  roomId: string | null = null;
  color: PlayerColor | null = null;

  onState?: (state: GameState) => void;
  onJoined?: (roomId: string, color: PlayerColor) => void;
  onError?: (error: string) => void;
  onClose?: () => void;

  /** Conecta ao servidor (ex.: ws://localhost:8080 ou wss://...). */
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Falha ao conectar ao servidor.'));
      ws.onclose = () => this.onClose?.();
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMessage;
        } catch {
          return;
        }
        if (msg.t === 'joined') {
          this.roomId = msg.roomId;
          this.color = msg.color;
          this.onJoined?.(msg.roomId, msg.color);
        } else if (msg.t === 'state') {
          this.onState?.(msg.state);
        } else if (msg.t === 'error') {
          this.onError?.(msg.error);
        }
      };
    });
  }

  /** Cria uma sala nova com a configuracao do lobby (vira o anfitriao). */
  create(config: GameConfig, name: string): void {
    this.sendRaw({ t: 'create', config, name });
  }

  /** Entra numa sala existente por id (ocupa uma vaga aberta). */
  join(roomId: string, name: string): void {
    this.sendRaw({ t: 'join', roomId, name });
  }

  /** Envia uma acao do jogador (o servidor valida pelo reduce). */
  send(action: Action): void {
    this.sendRaw({ t: 'action', action });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private sendRaw(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
