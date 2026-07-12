import type {
  Action,
  BoardLayout,
  DesertPlacement,
  ExpansionId,
  GameEvent,
  GameState,
  NumberLayout,
  PlayerColor,
} from '@trevalis/engine';
import type { Difficulty } from '@trevalis/bot';

/** Ritmo da partida (limite de tempo das acoes). */
export type Pace = 'fast' | 'normal';

/**
 * Configuracao de uma sala (montada pelo servidor a partir dos metadados no
 * banco + assentos ja ocupados — nao mais enviada solta pelo cliente). Cada
 * assento humano carrega o `userId` dono da vaga (usado por `GameRoom.seat`
 * para a reconexao por conta).
 */
export interface RoomConfig {
  seed: number;
  boardLayout: BoardLayout;
  /** Expansão/regras da partida (ausente = 'base'). */
  expansion?: ExpansionId;
  /** Cenário dentro da expansão (Navegadores). Opcional. */
  scenario?: string;
  pace: Pace;
  players: { color: PlayerColor; name: string; userId?: string }[];
  bots: PlayerColor[];
  botDifficulty: Record<PlayerColor, Difficulty>;
  numberLayout: NumberLayout;
  desert: DesertPlacement;
  pointsToWin: number;
  discardLimit: number;
  friendlyRobber: boolean;
  balancedDice: boolean;
}

/**
 * Mensagens do CLIENTE para o servidor. `enter` e a unica forma de entrar numa
 * sala — o servidor resolve tudo (config, assento) pelo `code` + a sessao
 * (cookie) autenticada na conexao WS.
 */
export type ClientMessage =
  | { t: 'enter'; code: string }
  | { t: 'action'; action: Action }
  /** Seleção TENTATIVA (ex.: cartas de descarte já escolhidas): o servidor a usa
   *  se o tempo acabar, em vez de um default aleatório (Colonist v196). */
  | { t: 'select'; action: Action }
  /** Mensagem de chat da partida. */
  | { t: 'chat'; text: string };

/** Uma mensagem de chat (broadcast a todos na sala). */
export interface ChatMessage {
  from: PlayerColor | null; // cor do autor (null = sistema/espectador — v1: só jogadores)
  name: string;
  text: string;
  at: number; // timestamp (ms)
}

/** Mensagens do SERVIDOR para o cliente. */
export type ServerMessage =
  | { t: 'joined'; code: string; color: PlayerColor | null; bots: PlayerColor[] } // color null = espectador
  | {
      t: 'state';
      state: GameState; // ja projetado (fog of war, ou tudo oculto p/ espectador)
      bots: PlayerColor[]; // cores que sao BOT (nunca tiveram conta) — em todo estado, p/ o cliente nao depender do 'joined'
      awayColors: PlayerColor[]; // assentos originalmente humanos hoje pilotados por bot
      deadlineSeconds: number | null; // prazo da janela atual (autoridade e sempre o servidor)
      events: GameEvent[]; // eventos ocorridos desde a ultima mensagem (log/toast/som no cliente)
    }
  | { t: 'chat'; message: ChatMessage } // mensagem de chat de um jogador
  | { t: 'chatHistory'; messages: ChatMessage[] } // histórico recente (ao entrar/reconectar)
  | { t: 'error'; error: string };
