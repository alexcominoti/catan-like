import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  publicScoreOf,
  handTotal,
  longestRoadLength,
  maritimeRate,
  COSTS,
  RESOURCES,
  TERRAIN_RESOURCE,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerColor,
  type ProgressCard,
  type Resource,
} from '@trevalis/engine';
import {
  Hexagon, Crown, Clock, Layers, Sparkles, Scroll, Swords, Trophy,
  Dices, ArrowLeftRight, Hand, MessageSquare, Send, Landmark,
  Volume2, VolumeX, HelpCircle, LogOut, Share2, Download, Ban,
} from 'lucide-react';
import { suggestSetupSettlement } from '@trevalis/bot';
import { Board, type InteractionMode } from './board/Board.js';
import { Dice } from './ui/Dice.js';
import { HandBar } from './ui/HandBar.js';
import { useFlyer, FlyLayer, type Pt, type FlyOpts } from './ui/FlyLayer.js';
import { RES_IMG, DEV_IMG } from './game/cards.js';
import { Toasts, useToasts, type ToastTone } from './ui/Toasts.js';
import { play as playSound, setMuted, unlockAudio, nudgeVolume, type SoundKind } from './ui/sound.js';
import type { GameClient } from './net/client.js';
import { PlayerMenu, useRelationships } from './site/PlayerMenu.js';
import { PLAYER_FILL, PLAYER_LABEL, RESOURCE_ICON, RESOURCE_LABEL } from './game/theme.js';

/**
 * Modo ONLINE: o RoomScreen e o dono da conexao (GameClient) e da assinatura
 * `onState`/`onError` — repassa aqui um "instantaneo" a cada mensagem nova do
 * servidor (identificada por `seq`/`errorSeq`, para o Game processar cada uma
 * exatamente uma vez). `viewerColor` null = espectador (sem `dispatch`).
 */
export interface OnlineGameProps {
  client: GameClient;
  viewerColor: PlayerColor | null;
  /** Cores NUNCA humanas (fixas desde o inicio da partida). */
  bots: PlayerColor[];
  /** Assentos humanos hoje pilotados por um bot (desconexao/AFK). */
  awayColors: PlayerColor[];
  deadlineSeconds: number | null;
  state: GameState;
  /** Eventos da ULTIMA mensagem de estado (log/toast/som) — [] na primeira. */
  events: GameEvent[];
  seq: number;
  error: string | null;
  errorSeq: number;
}

function fmtSecs(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

type LogEntry =
  | { kind: 'event'; text: string }
  | { kind: 'sep' };

interface ChatMsg {
  color: PlayerColor;
  name: string;
  text: string;
}

function zeroRes(): Record<Resource, number> {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

function canAffordUI(hand: Record<Resource, number>, cost: Partial<Record<Resource, number>>): boolean {
  return (Object.entries(cost) as [Resource, number][]).every(([r, n]) => hand[r] >= n);
}

function costIcons(cost: Partial<Record<Resource, number>>): string {
  return (Object.entries(cost) as [Resource, number][])
    .flatMap(([r, n]) => Array<string>(n).fill(RESOURCE_ICON[r]))
    .join('');
}

/** Brasao por cor (decorativo). */
const CREST: Record<PlayerColor, string> = { red: '👑', blue: '🌿', white: '⚒️', orange: '🪓', green: '🍀', brown: '🐗', purple: '🔮', pink: '🌸' };

function fmtTime(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Game({
  onExit,
  online,
}: {
  onExit: () => void;
  /** Toda partida é ONLINE: servidor autoritativo via WebSocket (não há mais hotseat local). */
  online: OnlineGameProps;
}) {
  // O estado é sempre controlado pelo RoomScreen a partir das mensagens do servidor.
  const state = online.state;
  const [log, setLog] = useState<LogEntry[]>([{ kind: 'event', text: 'Partida iniciada. Coloquem as vilas iniciais.' }]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<InteractionMode>('idle');
  const [give, setGive] = useState<Resource>('wood');
  const [want, setWant] = useState<Resource>('brick');
  const [arming, setArming] = useState<'yearOfPlenty' | 'monopoly' | 'trade' | 'counter' | null>(null);
  const [yopPicks, setYopPicks] = useState<Resource[]>([]);
  const [tradeGive, setTradeGive] = useState<Record<Resource, number>>(zeroRes);
  const [tradeWant, setTradeWant] = useState<Record<Resource, number>>(zeroRes);
  const [tradeAny, setTradeAny] = useState(0); // carta coringa: nº de recursos "quaisquer" pedidos
  // Oferta coringa a resolver ao aceitar (o aceitante escolhe quais recursos dar).
  const [wildcard, setWildcard] = useState<NonNullable<GameState['activeTrade']> | null>(null);
  // Troca RECUSADA por mim: escondida localmente (a oferta segue ativa no servidor
  // até o proponente resolver/expirar) para o popup não reaparecer a cada estado.
  const [dismissedTradeKey, setDismissedTradeKey] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // Quando o ladrao pode roubar de 2+ jogadores, o humano escolhe a vitima.
  const [robberChoice, setRobberChoice] = useState<{ hexId: string; victims: PlayerColor[] } | null>(null);
  // Confirmacao antes de construir.
  const [muted, setMutedState] = useState(false);
  const [elapsed, setElapsed] = useState(0); // cronometro da partida (segundos)
  const [turnCount, setTurnCount] = useState(1); // contador de turno
  const [chatInput, setChatInput] = useState('');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  // Menu de jogador (clicar no nome): perfil / amigo / bloquear. + minhas relações
  // (para o estado do botão de amizade e para esconder mensagens de bloqueados).
  const { data: relations, refresh: refreshRelations, blockedNames } = useRelationships();
  const [playerMenu, setPlayerMenu] = useState<{ username: string; x: number; y: number } | null>(null);
  const { toasts, push } = useToasts();
  const { items: flyItems, fly } = useFlyer();

  // Cronometro: conta enquanto a partida nao terminou.
  useEffect(() => {
    if (state.phase === 'ended') return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state.phase]);

  // Quando a oferta ativa some, esquece a recusa (uma oferta futura reaparece).
  useEffect(() => {
    if (!state.activeTrade) setDismissedTradeKey(null);
  }, [state.activeTrade]);

  function sendChat() {
    const t = chatInput.trim();
    if (!t) return;
    setChat((prev) => [...prev, { color: localColor, name: localPlayer.name, text: t }].slice(-200));
    setChatInput('');
  }

  // Bots: cores nunca humanas (fixas) + assentos humanos hoje pilotados por bot (AFK/desconexão).
  const isBot = useMemo(() => {
    const pureBots = new Set(online.bots);
    const away = new Set(online.awayColors);
    return (c: PlayerColor) => pureBots.has(c) || away.has(c);
  }, [online.bots, online.awayColors]);
  const botTurn = isBot(state.currentPlayer);

  // "Eu": sempre a MINHA cor fixa (null = espectador, sem ação).
  const localColor: PlayerColor = online.viewerColor ?? state.currentPlayer;
  const localPlayer = getPlayer(state, localColor);
  const isSpectator = online.viewerColor == null;
  const myTurn = !isSpectator && state.currentPlayer === localColor;

  const effMode: InteractionMode = useMemo(() => {
    if (isBot(state.currentPlayer)) return 'idle'; // humano nao age na vez do bot
    if (state.phase === 'setup1' || state.phase === 'setup2') {
      return state.setupLastVertex ? 'placeRoad' : 'placeSettlement';
    }
    if (state.phase === 'moveBlocker') return 'moveBlocker';
    // Fase principal: sem precisar armar — hover direto constroi (estrada/vila/cidade).
    // Os botoes (se clicados) filtram para um tipo so.
    if (state.phase === 'main') return mode === 'idle' ? 'mainBuild' : mode;
    return 'idle';
  }, [state.phase, state.setupLastVertex, state.currentPlayer, mode, isBot]);

  // Dica do melhor spot: so durante o setup, quando o humano vai colocar a vila.
  const setupHint = useMemo(
    () => (effMode === 'placeSettlement' ? suggestSetupSettlement(state, state.currentPlayer) : null),
    [effMode, state],
  );

  function resetTransient() {
    setArming(null);
    setYopPicks([]);
    setTradeGive(zeroRes());
    setTradeWant(zeroRes());
    setTradeAny(0);
  }

  /**
   * Log/toasts/sons a partir de eventos do motor — usado tanto pelo `dispatch`
   * local (logo apos o `reduce`) quanto pelas mensagens de estado do servidor
   * no modo online (que nao expoe `action`/`by`, so os eventos ja ocorridos).
   */
  function applyEvents(events: GameEvent[], newState: GameState) {
    const lines: LogEntry[] = events
      .map((e) => describeEvent(e, newState))
      .filter(Boolean)
      .map((text) => ({ kind: 'event' as const, text }));
    const sep: LogEntry[] = events.some((e) => e.t === 'turnEnded') ? [{ kind: 'sep' as const }] : [];
    setLog((prev) => [...lines, ...sep, ...prev].slice(0, 200));
    for (const e of events) {
      const t = toastForEvent(e, newState);
      if (t) push(t.text, t.tone);
      const s = soundForEvent(e);
      if (s) playSound(s);
    }
    if (events.some((e) => e.t === 'turnEnded' || e.t === 'gameWon')) setMode('idle');
    if (events.some((e) => e.t === 'turnEnded')) setTurnCount((n) => n + 1);
  }

  /** Envia a ação ao servidor autoritativo (otimista: o servidor confirma via novo `state`/`error`). */
  function dispatch(action: Action): boolean {
    if (online.viewerColor == null) return false; // espectador: sem ação
    online.client.send(action);
    resetTransient();
    return true;
  }

  // Online: processa a mensagem de estado mais recente do servidor exatamente
  // uma vez (identificada por `seq`) — log/toasts/sons E as animacoes de voo,
  // reconstruidas a partir dos eventos + estado (ver scheduleOnlineAnimations).
  const lastSeqRef = useRef(-1);
  const prevOnlineBlockerRef = useRef<string | null>(null);
  useEffect(() => {
    if (online.seq === lastSeqRef.current) return;
    lastSeqRef.current = online.seq;
    const prevBlocker = prevOnlineBlockerRef.current;
    if (online.events.length > 0) {
      applyEvents(online.events, online.state);
      // prevBlocker null = primeiro instantaneo (enter): so registra, sem animar.
      if (prevBlocker !== null) scheduleOnlineAnimations(online.events, online.state, prevBlocker);
    }
    prevOnlineBlockerRef.current = online.state.blocker.hexId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online.seq]);

  // Online: erros do servidor (acao rejeitada) — mostrados exatamente uma vez.
  const lastErrSeqRef = useRef(-1);
  useEffect(() => {
    if (online.errorSeq === lastErrSeqRef.current) return;
    lastErrSeqRef.current = online.errorSeq;
    if (online.error) {
      setError(online.error);
      push(online.error, 'warn');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online.errorSeq]);

  /**
   * Anima cartas/peças voando (espera o DOM atualizar), reconstruídas só a partir dos eventos +
   * estado que o servidor envia (o protocolo não expõe a `action` original):
   *  - produção de recursos: soma dos dados + tabuleiro (idêntico ao local);
   *  - ladrão movido/roubo: `prevBlocker` (rastreado) + `by` no evento;
   *  - gasto p/ o banco: derivado por dono dos eventos `built`/carta/troca.
   */
  function scheduleOnlineAnimations(events: GameEvent[], newState: GameState, prevBlocker: string) {
    const rolled = events.find((e) => e.t === 'diceRolled');
    const producedSum = rolled && events.some((e) => e.t === 'produced') ? rolled.sum : null;
    const moved = events.find((e) => e.t === 'blockerMoved');
    const spends = spentByOwnerFromEvents(events);
    if (producedSum === null && !moved && spends.length === 0) return;

    raf2(() => {
      const svg = document.querySelector<SVGSVGElement>('.board-wrap > svg');
      if (producedSum !== null && svg) animateProduced(fly, svg, producedSum, newState, localColor);
      if (moved && svg) animateRobberMove(fly, svg, moved, prevBlocker, newState);
      if (moved) animateSteal(fly, moved, localColor);
      for (const s of spends) animateSpend(fly, s.owner, s.spend, localColor);
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMode('idle');
        setArming(null);
        setYopPicks([]);
        setHelp(false);
        setError(null);
      }
    }
    function onPointer() {
      unlockAudio();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  // Bots e resolução de trocas por tempo são responsabilidade do SERVIDOR
  // (GameRoom.runBots / deadline+forceTimeout) — o cliente só envia as ações do humano.

  // Toca um som quando vira a minha vez (entrada na fase de rolar).
  const wasMyRoll = useRef(false);
  useEffect(() => {
    const isMyRoll = myTurn && state.phase === 'roll';
    if (isMyRoll && !wasMyRoll.current) playSound('yourTurn');
    wasMyRoll.current = isMyRoll;
  }, [myTurn, state.phase]);

  // O Board confirma a construcao inline (chip ✓) e ja envia a acao pronta.
  function onBuild(action: Action) {
    dispatch(action);
  }
  function onHex(hid: string) {
    if (effMode !== 'moveBlocker') return;
    const hex = state.board.hexes[hid]!;
    const me = state.currentPlayer;
    const victims = [...new Set(
      hex.corners
        .map((vid) => state.buildings[vid]?.owner)
        .filter((o): o is PlayerColor =>
          !!o && o !== me && handTotal(getPlayer(state, o)) > 0 &&
          // Ladrao amigavel: nao oferece roubar de quem tem <3 PV.
          (!state.friendlyRobber || publicScoreOf(state, o) >= 3),
        ),
    )];
    if (victims.length >= 2) {
      setRobberChoice({ hexId: hid, victims }); // humano escolhe de quem roubar
    } else {
      dispatch({ t: 'moveBlocker', hexId: hid, ...(victims[0] ? { stealFrom: victims[0] } : {}) });
    }
  }

  function canPlay(card: ProgressCard): boolean {
    if (!myTurn) return false;
    const have = localPlayer.progressCards.filter((c) => c === card).length;
    const bought = localPlayer.progressCardsBoughtThisTurn.filter((c) => c === card).length;
    if (have - bought <= 0) return false;
    if (state.devCardPlayedThisTurn) return false;
    return state.phase === 'main' || (card === 'knight' && state.phase === 'roll');
  }
  function playCard(card: ProgressCard) {
    if (card === 'knight') dispatch({ t: 'playKnight' });
    else if (card === 'roadBuilding') {
      if (dispatch({ t: 'playRoadBuilding' })) setMode('buildRoad');
    } else if (card === 'yearOfPlenty') {
      setArming('yearOfPlenty');
      setYopPicks([]);
    } else if (card === 'monopoly') setArming('monopoly');
  }

  // Abre o construtor de troca como CONTRAPROPOSTA: pré-preenche com a oferta
  // invertida (você dá o que ele pediu; pede o que ele ofereceu) e você edita.
  function openCounter(t: NonNullable<GameState['activeTrade']>) {
    const giveFill = zeroRes();
    const wantFill = zeroRes();
    for (const r of RESOURCES) {
      // O que eu daria começa pelo que ele pediu, mas limitado ao que tenho.
      giveFill[r] = Math.min(t.want[r] ?? 0, localPlayer.hand[r]);
      // O que eu quero começa pelo que ele ofereceu.
      wantFill[r] = t.give[r] ?? 0;
    }
    setTradeGive(giveFill);
    setTradeWant(wantFill);
    setArming('counter');
  }

  const cur = getPlayer(state, state.currentPlayer);
  const myMain = myTurn && state.phase === 'main';
  const myRoll = myTurn && state.phase === 'roll';
  const bestRate = maritimeRate(state, localColor, give);
  const playerColor = PLAYER_FILL[state.currentPlayer];

  // Mapa nome -> cor para pintar os nomes no Pergaminho (o proprio `state` ja
  // carrega o nome de cada jogador — funciona igual online e local).
  const logNames = useMemo<NameColor[]>(
    () => state.players.map((p) => ({ name: p.name, color: PLAYER_FILL[p.color] })),
    [state.players],
  );

  const [secsLeft, setSecsLeft] = useState<number | null>(null);

  // Só EXIBE a contagem que o servidor manda (ele é a autoridade do timeout, via
  // GameRoom.forceTimeout) — reinicia a cada mensagem nova de estado, que já
  // reflete o tempo restante correto naquele instante.
  useEffect(() => {
    if (online.deadlineSeconds == null) {
      setSecsLeft(null);
      return;
    }
    const secs = online.deadlineSeconds;
    setSecsLeft(secs);
    const deadline = Date.now() + secs * 1000;
    const iv = setInterval(() => setSecsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online.seq, online.deadlineSeconds]);

  // Atalhos de teclado (Colonist v140/v151/v152): Espaço rola os dados / passa a
  // vez; M muda o som; ↑/↓ ajustam o volume; F alterna a tela cheia. ESC (cancelar)
  // já está no efeito acima. Ignora quando o foco está num campo/botão.
  useEffect(() => {
    function blocked(el: EventTarget | null): boolean {
      const tag = (el as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
    }
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || blocked(e.target)) return;
      switch (e.key) {
        case ' ':
          if (myRoll) { e.preventDefault(); dispatch({ t: 'rollDice' }); }
          else if (myMain) { e.preventDefault(); dispatch({ t: 'endTurn' }); }
          break;
        case 'm': case 'M':
          setMutedState((m) => { const n = !m; setMuted(n); return n; });
          break;
        case 'f': case 'F':
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.();
          break;
        case 'ArrowUp':
          e.preventDefault(); push(`🔊 Volume ${Math.round(nudgeVolume(0.1) * 100)}%`, 'info');
          break;
        case 'ArrowDown':
          e.preventDefault(); push(`🔊 Volume ${Math.round(nudgeVolume(-0.1) * 100)}%`, 'info');
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRoll, myMain]);

  const resourceCount = RESOURCES.reduce((s, r) => s + localPlayer.hand[r], 0);

  return (
    <div className="game site bg-paper" style={{ ['--turn-color' as string]: playerColor }}>
      <header className="game-header">
        <span className="brand"><span className="brand-mark"><Hexagon size={18} strokeWidth={2.5} /></span> Trevalis</span>
        <span className="turn-chip"><Clock size={13} /> Turno {turnCount}</span>
        <div className="game-header-actions">
          <button className="hbtn icon-only" title={muted ? 'Som desligado' : 'Som ligado'} onClick={() => { const m = !muted; setMutedState(m); setMuted(m); }}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
          <button className="hbtn" onClick={() => setHelp(true)}><HelpCircle size={15} /> Ajuda</button>
          <button className="ghost" onClick={onExit}><LogOut size={15} /> Sair</button>
        </div>
      </header>

      <div className="game-body">
        {/* ESQUERDA — Nobres */}
        <aside className="nobres">
          <div className="nobres-head">
            <h2><Crown size={18} className="ic-primary" /> Nobres</h2>
            <span className="match-timer"><Clock size={13} /> {fmtTime(elapsed)}</span>
          </div>
          {state.players.map((p) => {
            const hasRoad = state.longestRoad.owner === p.color;
            const hasArmy = state.largestArmy.owner === p.color;
            return (
              <div key={p.color} className={`noble${p.color === state.currentPlayer ? ' active' : ''}`}
                style={{ ['--pc' as string]: PLAYER_FILL[p.color] }}>
                <div className="noble-left">
                  <span className="noble-crest" data-noble={p.color} style={{ background: PLAYER_FILL[p.color] }}>{CREST[p.color]}</span>
                  <div className="noble-pts"><b>{publicScoreOf(state, p.color)}</b><span>pts</span></div>
                </div>
                <div className="noble-main">
                  <div className="noble-name">
                    {/* Opções de jogador (perfil/amizade/bloquear) só para HUMANOS —
                        nunca para bots nem assentos controlados por bot ("🤖 assumiu"). */}
                    {(!isBot(p.color) && p.color !== online.viewerColor) ? (
                      <button className="noble-nick as-link" title="Opções do jogador"
                        onClick={(e) => setPlayerMenu({ username: p.name, x: e.clientX, y: e.clientY })}>{p.name}</button>
                    ) : (
                      <span className="noble-nick">{p.name}</span>
                    )}
                    {!isSpectator && p.color === localColor && <span className="you-tag">você</span>}
                    {online && online.awayColors.includes(p.color) ? (
                      <span className="bot-tag" title="Desconectado: um bot médio assumiu temporariamente">🤖 assumiu</span>
                    ) : (
                      isBot(p.color) && <span className="bot-tag">bot</span>
                    )}
                    {!isSpectator && p.color !== localColor && (() => {
                      const on = (state.embargoes ?? []).some((e) => e.by === localColor && e.target === p.color);
                      return (
                        <button className={`embargo-btn${on ? ' on' : ''}`}
                          title={on ? 'Embargo ativo — clique para comerciar de novo' : 'Embargar: recusar comércio com este jogador'}
                          onClick={() => dispatch({ t: 'setEmbargo', target: p.color, on: !on })}>
                          <Ban size={12} />
                        </button>
                      );
                    })()}
                  </div>
                  <div className="noble-stats">
                    <Stat icon={<Layers size={12} />} label={`${handTotal(p)} recursos`} />
                    <Stat icon={<Sparkles size={12} />} label={`${p.progressCards.length} desenv.`} />
                    <Stat icon={<Scroll size={12} />} label={`${longestRoadLength(state, p.color)} estradas`} hl={hasRoad} />
                    <Stat icon={<Swords size={12} />} label={`${p.knightsPlayed} cav.`} hl={hasArmy} />
                  </div>
                  {(hasRoad || hasArmy) && (
                    <div className="noble-badges">
                      {hasRoad && <TitleBadge icon={<Scroll size={11} />} label="Maior Estrada" />}
                      {hasArmy && <TitleBadge icon={<Swords size={11} />} label="Maior Exército" />}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div className="title-cards">
            <TitleCard icon={<Scroll size={15} className="ic-primary" />} title="Maior Estrada"
              owner={state.longestRoad.owner ? `${PLAYER_LABEL[state.longestRoad.owner]} · ${state.longestRoad.length} segmentos` : '— ainda em disputa'}
              earned={!!state.longestRoad.owner} hint="5+ estradas conectadas = +2 PV" />
            <TitleCard icon={<Swords size={15} className="ic-primary" />} title="Maior Exército"
              owner={state.largestArmy.owner ? `${PLAYER_LABEL[state.largestArmy.owner]} · ${state.largestArmy.size} cavaleiros` : '— ainda em disputa'}
              earned={!!state.largestArmy.owner} hint="3+ cavaleiros jogados = +2 PV" />
          </div>
        </aside>

        {/* CENTRO — tabuleiro + mão */}
        <main className="center">
          <div className="center-top">
            <div>
              <p className="eyebrow-turn">{myTurn ? 'Sua vez, nobre' : botTurn ? `Vez de ${cur.name}` : 'Aguardando'}</p>
              <h2>{headline(state, myTurn, botTurn, cur.name)}</h2>
            </div>
            {secsLeft != null && (
              <div className={`turn-timer${secsLeft <= 5 ? ' danger' : ''}`} title="Tempo para a sua jogada">
                <Clock size={15} /> {fmtSecs(secsLeft)}
              </div>
            )}
          </div>

          <div className="board-wrap" style={{ borderColor: playerColor }}>
            <Board state={state} mode={effMode} hintVertex={setupHint} onBuild={onBuild} onHex={onHex} />
            {state.activeTrade && tradeKeyOf(state.activeTrade) !== dismissedTradeKey && (
              <ActiveTradePopup state={state} dispatch={dispatch} localColor={localColor}
                botOffer={isBot(state.activeTrade.from)} onCounter={() => openCounter(state.activeTrade!)}
                onWildcardAccept={() => setWildcard(state.activeTrade)}
                onRefuse={() => { setDismissedTradeKey(tradeKeyOf(state.activeTrade!)); dispatch({ t: 'respondTrade', accept: false }); }} />
            )}
            <Dice dice={state.dice} />
            {myRoll && (
              <button className="roll-btn roll-on-board pulse" onClick={() => dispatch({ t: 'rollDice' })}>
                <Dices size={16} /> Rolar dados
              </button>
            )}
          </div>

          <div className="center-hand">
            <div className="hand-head">
              <div>
                <p className="eyebrow">Sua mão</p>
                <p className="hand-count">
                  {resourceCount + localPlayer.progressCards.length} cartas
                  <span className="muted-note"> ({resourceCount} recursos)</span>
                  {resourceCount > state.discardLimit && <span className="over-limit">acima do limite: ladrão pode roubar</span>}
                </p>
              </div>
              <div className="hand-actions">
                <BuildButton label="Estrada" cost={COSTS.road} active={mode === 'buildRoad'} hand={localPlayer.hand}
                  enabled={(myMain && canAffordUI(localPlayer.hand, COSTS.road)) || (myMain && state.pendingFreeRoads > 0)}
                  free={state.pendingFreeRoads > 0} onClick={() => toggle('buildRoad')} />
                <BuildButton label="Vila" cost={COSTS.settlement} active={mode === 'buildSettlement'} hand={localPlayer.hand}
                  enabled={myMain && canAffordUI(localPlayer.hand, COSTS.settlement)} onClick={() => toggle('buildSettlement')} />
                <BuildButton label="Cidade" cost={COSTS.city} active={mode === 'buildCity'} hand={localPlayer.hand}
                  enabled={myMain && canAffordUI(localPlayer.hand, COSTS.city)} onClick={() => toggle('buildCity')} />
                <BuildButton label="Carta" cost={COSTS.progressCard} hand={localPlayer.hand}
                  enabled={myMain && canAffordUI(localPlayer.hand, COSTS.progressCard) && (state.devDeckCount ?? state.devDeck.length) > 0}
                  onClick={() => dispatch({ t: 'buyProgressCard' })} />
                <span className="trade-bank">
                  <select value={give} onChange={(e) => setGive(e.target.value as Resource)} disabled={!myMain}>
                    {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_ICON[r]}×{maritimeRate(state, localColor, r)}</option>)}
                  </select>
                  →
                  <select value={want} onChange={(e) => setWant(e.target.value as Resource)} disabled={!myMain}>
                    {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_ICON[r]}</option>)}
                  </select>
                  <button disabled={!myMain || localPlayer.hand[give] < bestRate} onClick={() => dispatch({ t: 'tradeBank', give, want })}>{bestRate}:1</button>
                </span>
                <button className="hbtn" disabled={!myMain || !!state.activeTrade} onClick={() => setArming('trade')}><ArrowLeftRight size={14} /> Trocar</button>
                <button className="hbtn primary-soft" disabled={!myMain} onClick={() => dispatch({ t: 'endTurn' })}><Hand size={14} /> Passar</button>
              </div>
            </div>
            <div className="hand-error">{error && <>⚠ {error}</>}</div>
            <HandBar hand={localPlayer.hand} devCards={localPlayer.progressCards} canPlay={canPlay} onPlay={playCard} />
          </div>
        </main>

        {/* DIREITA — Pergaminho (log) + Chat + Banco */}
        <aside className="pergaminho">
          <div className="card scroll-card">
            <h2><MessageSquare size={16} className="ic-primary" /> Pergaminho</h2>
            <div className="log">{log.map((entry, i) => <LogLine key={i} entry={entry} names={logNames} />)}</div>
          </div>

          <div className="card chat-card">
            <h3 className="chat-head"><MessageSquare size={14} className="ic-primary" /> Chat</h3>
            <div className="chat-log">
              {chat.length === 0 && <p className="muted-note">Sem mensagens ainda</p>}
              {/* Bloquear esconde as mensagens do jogador bloqueado. */}
              {[...chat].reverse().filter((m) => !blockedNames.has(m.name.toLowerCase())).map((m, i) => (
                <div key={i} className="log-chat"><b style={{ color: PLAYER_FILL[m.color] }}>{m.name}:</b> {m.text}</div>
              ))}
            </div>
            <div className="chat-row">
              <input value={chatInput} placeholder="Mensagem ou /comando"
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }} />
              <button onClick={sendChat} aria-label="Enviar"><Send size={15} /></button>
            </div>
          </div>

          <div className="card bank-card" data-anchor="bank">
            <h2><Landmark size={16} className="ic-primary" /> Banco</h2>
            <div className="bank-grid">
              {RESOURCES.map((r) => (
                <div key={r} className="bank-pile" title={RESOURCE_LABEL[r]}>
                  <img src={RES_IMG[r]} alt={RESOURCE_LABEL[r]} />
                  <span className="card-count">{state.bank[r]}</span>
                </div>
              ))}
              <div className="bank-pile" title="Cartas de desenvolvimento no baralho">
                <img src={DEV_IMG.victoryPoint} alt="Desenvolvimento" />
                <span className="card-count">{state.devDeckCount ?? state.devDeck.length}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <Toasts toasts={toasts} />
      <FlyLayer items={flyItems} />

      {help && <HelpModal onClose={() => setHelp(false)} />}
      {arming === 'monopoly' && (
        <ResourcePickerModal title="Monopólio — escolha o recurso"
          onPick={(r) => dispatch({ t: 'playMonopoly', resource: r })} onClose={() => setArming(null)} />
      )}
      {arming === 'yearOfPlenty' && (
        <ResourcePickerModal title={`+2 Recursos — escolha ${2 - yopPicks.length} (${yopPicks.map((r) => RESOURCE_ICON[r]).join(' ')})`}
          onPick={(r) => {
            const picks = [...yopPicks, r];
            if (picks.length === 2) dispatch({ t: 'playYearOfPlenty', resources: [picks[0]!, picks[1]!] });
            else setYopPicks(picks);
          }}
          onClose={() => { setArming(null); setYopPicks([]); }} />
      )}
      {(arming === 'trade' || arming === 'counter') && (
        <TradeBuilderModal state={state} proposer={localColor} tradeGive={tradeGive} tradeWant={tradeWant}
          counter={arming === 'counter'} wantAny={tradeAny}
          setTradeGive={setTradeGive} setTradeWant={setTradeWant} setWantAny={setTradeAny}
          onPropose={(to) =>
            arming === 'counter'
              ? dispatch({ t: 'counterTrade', give: tradeGive, want: tradeWant })
              : dispatch({ t: 'proposeTrade', give: tradeGive, want: tradeWant, wantAny: tradeAny, to })
          }
          onClose={resetTransient} />
      )}
      {wildcard && (
        <WildcardPickModal
          state={state}
          color={localColor}
          count={wildcard.wantAny!}
          onConfirm={(resolveAny) => { dispatch({ t: 'respondTrade', accept: true, resolveAny }); setWildcard(null); }}
          onClose={() => setWildcard(null)}
        />
      )}
      {robberChoice && (
        <RobberVictimModal
          state={state}
          victims={robberChoice.victims}
          onPick={(victim) => { dispatch({ t: 'moveBlocker', hexId: robberChoice.hexId, stealFrom: victim }); setRobberChoice(null); }}
        />
      )}
      {(() => {
        // Online: cada cliente só descarta as PRÓPRIAS cartas (o servidor aplica
        // pela conexão); mostro o modal só quando EU tenho descarte pendente.
        if (state.phase !== 'discard' || isSpectator) return null;
        if ((state.pendingDiscards[localColor] ?? 0) <= 0) return null;
        return (
          <DiscardModal
            state={state}
            color={localColor}
            count={state.pendingDiscards[localColor]!}
            onDiscard={(resources) => dispatch({ t: 'discard', resources })}
            onSelect={(resources) => online.client.sendSelect({ t: 'discard', resources })}
          />
        );
      })()}
      {state.phase === 'ended' && state.winner && (
        <EndGameOverlay state={state} localColor={localColor} elapsed={elapsed} turns={turnCount} onExit={onExit}
          botColors={online.bots} awayColors={online.awayColors} viewerColor={online.viewerColor}
          onPlayer={(username, x, y) => setPlayerMenu({ username, x, y })} />
      )}
      {playerMenu && (
        <PlayerMenu username={playerMenu.username} data={relations} x={playerMenu.x} y={playerMenu.y}
          onAction={refreshRelations} onClose={() => setPlayerMenu(null)} />
      )}
    </div>
  );

  function toggle(m: InteractionMode) {
    setMode((c) => (c === m ? 'idle' : m));
    setError(null);
  }
}

function BuildButton({
  label,
  cost,
  active,
  enabled,
  free,
  hand,
  onClick,
}: {
  label: string;
  cost: Partial<Record<Resource, number>>;
  active?: boolean;
  enabled: boolean;
  free?: boolean;
  hand: Record<Resource, number>;
  onClick: () => void;
}) {
  return (
    <button className={`build-btn${active ? ' active' : ''}`} disabled={!enabled} onClick={onClick}
      title={`Custo: ${costIcons(cost)}`}>
      <span>{label}</span>
      <small className={canAffordUI(hand, cost) || free ? '' : 'short'}>{free ? 'grátis' : costIcons(cost)}</small>
    </button>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const terr: [string, string][] = [
    ['🌲', 'Floresta → Madeira'],
    ['🧱', 'Colinas → Tijolo'],
    ['🐑', 'Pasto → Lã'],
    ['🌾', 'Campo → Trigo'],
    ['⛰️', 'Montanha → Minério'],
  ];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Como jogar</h3>
        <h4>Terrenos e recursos</h4>
        <ul className="help-list">{terr.map(([i, t]) => <li key={t}>{i} {t}</li>)}</ul>
        <h4>Custos</h4>
        <ul className="help-list">
          <li>Estrada: {costIcons(COSTS.road)}</li>
          <li>Vila: {costIcons(COSTS.settlement)}</li>
          <li>Cidade: {costIcons(COSTS.city)}</li>
          <li>Carta: {costIcons(COSTS.progressCard)}</li>
        </ul>
        <h4>Portos</h4>
        <p className="muted-note">3:1 troca 3 iguais por 1 qualquer · 2:1 troca 2 do recurso do porto.</p>
        <h4>Controles</h4>
        <p className="muted-note">Passe o mouse para ver alvos válidos · clique para colocar.</p>
        <h4>Atalhos de teclado</h4>
        <ul className="help-list">
          <li><b>Espaço</b> — rolar os dados / passar a vez</li>
          <li><b>M</b> — ligar/desligar o som · <b>↑ / ↓</b> — volume</li>
          <li><b>F</b> — tela cheia · <b>ESC</b> — cancelar</li>
        </ul>
        <button className="link" onClick={onClose}>Fechar (ESC)</button>
      </div>
    </div>
  );
}

function ResourcePickerModal({ title, onPick, onClose }: { title: string; onPick: (r: Resource) => void; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="hand">
          {RESOURCES.map((r) => <button key={r} onClick={() => onPick(r)}>{RESOURCE_ICON[r]} {RESOURCE_LABEL[r]}</button>)}
        </div>
        <button className="link" onClick={onClose}>Cancelar (ESC)</button>
      </div>
    </div>
  );
}

function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="stepper">
      <button onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>−</button>
      <b>{value}</b>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>＋</button>
    </span>
  );
}

function TradeBuilderModal({
  state, proposer, counter, tradeGive, tradeWant, wantAny, setTradeGive, setTradeWant, setWantAny, onPropose, onClose,
}: {
  state: GameState;
  proposer: PlayerColor;
  counter?: boolean;
  tradeGive: Record<Resource, number>;
  tradeWant: Record<Resource, number>;
  wantAny: number;
  setTradeGive: (v: Record<Resource, number>) => void;
  setTradeWant: (v: Record<Resource, number>) => void;
  setWantAny: (v: number) => void;
  onPropose: (to: PlayerColor[]) => void;
  onClose: () => void;
}) {
  const others = state.players.filter((p) => p.color !== proposer).map((p) => p.color);
  const [to, setTo] = useState<PlayerColor[]>(others);
  const cur = state.players.find((p) => p.color === proposer)!;
  const total = (m: Record<Resource, number>) => RESOURCES.reduce((s, r) => s + m[r], 0);
  const wantTotal = total(tradeWant) + (counter ? 0 : wantAny);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>{counter ? 'Contraproposta' : 'Propor troca'}</h3>
        <div className="trade-grid">
          <div>
            <h4>Você dá</h4>
            {RESOURCES.map((r) => (
              <div key={r} className="trade-row">
                <span>{RESOURCE_ICON[r]} {RESOURCE_LABEL[r]} <small className="have">({cur.hand[r]})</small></span>
                <Stepper value={tradeGive[r]} max={cur.hand[r]} onChange={(v) => setTradeGive({ ...tradeGive, [r]: v })} />
              </div>
            ))}
          </div>
          <div>
            <h4>Você quer</h4>
            {RESOURCES.map((r) => (
              <div key={r} className="trade-row">
                <span>{RESOURCE_ICON[r]} {RESOURCE_LABEL[r]}</span>
                <Stepper value={tradeWant[r]} max={19} onChange={(v) => setTradeWant({ ...tradeWant, [r]: v })} />
              </div>
            ))}
            {!counter && (
              <div className="trade-row trade-any">
                <span title="Coringa: quem aceitar escolhe quais recursos dar">🃏 Qualquer recurso</span>
                <Stepper value={wantAny} max={9} onChange={setWantAny} />
              </div>
            )}
          </div>
        </div>
        {!counter && (
          <div className="trade-recipients">
            <span>Para:</span>
            {others.map((c) => (
              <label key={c} className="chk">
                <input type="checkbox" checked={to.includes(c)}
                  onChange={(e) => setTo((cur2) => (e.target.checked ? [...cur2, c] : cur2.filter((x) => x !== c)))} />
                <span className="swatch" style={{ background: PLAYER_FILL[c] }} /> {PLAYER_LABEL[c]}
              </label>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="primary" disabled={total(tradeGive) === 0 || wantTotal === 0 || (!counter && to.length === 0)}
            onClick={() => onPropose(to)}>{counter ? 'Enviar contraproposta' : 'Propor'}</button>
          <button onClick={onClose}>Cancelar (ESC)</button>
        </div>
      </div>
    </div>
  );
}

/** Ao aceitar uma oferta CORINGA, quem aceita escolhe quais recursos dar (total = count). */
function WildcardPickModal({
  state, color, count, onConfirm, onClose,
}: {
  state: GameState;
  color: PlayerColor;
  count: number;
  onConfirm: (resolveAny: Partial<Record<Resource, number>>) => void;
  onClose: () => void;
}) {
  const hand = getPlayer(state, color).hand;
  const [picks, setPicks] = useState<Record<Resource, number>>(zeroRes);
  const total = RESOURCES.reduce((s, r) => s + picks[r], 0);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>🃏 Escolha {count} recurso(s) para o coringa</h3>
        <p className="muted-note">Selecionados: {total}/{count}</p>
        <div className="trade-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div>
            {RESOURCES.map((r) => (
              <div key={r} className="trade-row">
                <span>{RESOURCE_ICON[r]} {RESOURCE_LABEL[r]} ({hand[r]})</span>
                <Stepper value={picks[r]} max={Math.min(hand[r], picks[r] + Math.max(0, count - total))} onChange={(v) => setPicks((p) => ({ ...p, [r]: v }))} />
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="primary" disabled={total !== count} onClick={() => onConfirm(picks)}>Aceitar troca</button>
          <button onClick={onClose}>Cancelar (ESC)</button>
        </div>
      </div>
    </div>
  );
}

/** Assinatura estável de uma oferta (para lembrar qual eu recusei). */
function tradeKeyOf(t: NonNullable<GameState['activeTrade']>): string {
  return `${t.from}:${JSON.stringify(t.give)}:${JSON.stringify(t.want)}:${t.wantAny ?? 0}`;
}

/** Painel de troca no canto do mapa (sem escurecer a tela). */
function ActiveTradePopup({
  state,
  dispatch,
  localColor,
  botOffer,
  onCounter,
  onWildcardAccept,
  onRefuse,
}: {
  state: GameState;
  dispatch: (a: Action, by?: PlayerColor) => boolean;
  localColor: PlayerColor;
  botOffer: boolean;
  onCounter: () => void;
  onWildcardAccept: () => void;
  onRefuse: () => void;
}) {
  const t = state.activeTrade!;
  const fmt = (m: Partial<Record<Resource, number>>) =>
    (Object.entries(m) as [Resource, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${n}${RESOURCE_ICON[r]}`).join(' ') || '—';
  const wantLabel = `${fmt(t.want)}${t.wantAny ? `${Object.values(t.want).some((n) => n > 0) ? ' + ' : ''}${t.wantAny}🃏` : ''}`;
  const iAmProposer = t.from === localColor;
  const iAmRecipient = t.to.includes(localColor);
  // Barra de tempo (20s): na oferta de um bot para mim, ou quando EU proponho.
  const showTimer = iAmProposer || (botOffer && iAmRecipient);
  return (
    <div className="trade-popup">
      <h3>{PLAYER_LABEL[t.from]} quer trocar</h3>
      <p className="trade-summary">Dá <b>{fmt(t.give)}</b> &nbsp;→&nbsp; quer <b>{wantLabel}</b></p>
      {showTimer && (
        // key muda a cada nova proposta -> a barra remonta e o tempo reinicia em sincronia.
        <div className="trade-timer">
          <span key={`${t.from}:${JSON.stringify(t.give)}:${JSON.stringify(t.want)}`} className="trade-timer-bar" />
        </div>
      )}
      {iAmProposer ? (
        <>
          <div className="trade-responders">
            {t.to.map((c) => {
              const accepted = t.accepted.includes(c);
              return (
                <div key={c} className="trade-row">
                  <span><span className="swatch" style={{ background: PLAYER_FILL[c] }} /> {PLAYER_LABEL[c]} {accepted ? '✅' : '⏳'}</span>
                  <button className="primary" disabled={!accepted} onClick={() => dispatch({ t: 'confirmTrade', with: c }, t.from)}>Fechar</button>
                </div>
              );
            })}
          </div>
          <div className="modal-actions">
            <button onClick={() => dispatch({ t: 'cancelTrade' }, t.from)}>Cancelar</button>
          </div>
        </>
      ) : iAmRecipient ? (
        <div className="modal-actions wrap">
          <button onClick={onRefuse}>✗ Recusar</button>
          <button onClick={onCounter}>✎ Contraproposta</button>
          <button className="primary"
            onClick={() => (t.wantAny ? onWildcardAccept() : dispatch({ t: 'respondTrade', accept: true }, localColor))}>
            ✓ Aceitar
          </button>
        </div>
      ) : (
        <p className="muted-note">Aguardando resposta…</p>
      )}
    </div>
  );
}

/** Escolha de quem roubar quando o hex toca 2+ adversarios com cartas. */
function RobberVictimModal({
  state,
  victims,
  onPick,
}: {
  state: GameState;
  victims: PlayerColor[];
  onPick: (victim: PlayerColor) => void;
}) {
  return (
    <div className="overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Roubar de quem?</h3>
        <div className="dev-cards">
          {victims.map((c) => (
            <button key={c} onClick={() => onPick(c)}>
              <span className="swatch" style={{ background: PLAYER_FILL[c] }} /> {PLAYER_LABEL[c]} · {handTotal(getPlayer(state, c))} cartas
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** O jogador humano escolhe quais cartas descartar (total = count). */
function DiscardModal({
  state,
  color,
  count,
  onDiscard,
  onSelect,
}: {
  state: GameState;
  color: PlayerColor;
  count: number;
  onDiscard: (resources: Partial<Record<Resource, number>>) => void;
  /** Envia a seleção tentativa ao servidor (usada se o tempo acabar). */
  onSelect: (resources: Partial<Record<Resource, number>>) => void;
}) {
  const hand = getPlayer(state, color).hand;
  const [picks, setPicks] = useState<Record<Resource, number>>({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
  const total = RESOURCES.reduce((s, r) => s + picks[r], 0);
  // Salva a seleção completa no servidor: se o tempo acabar, ela é usada em vez
  // de um descarte aleatório (Colonist v196).
  useEffect(() => {
    if (total === count) onSelect(picks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, total, count]);
  return (
    <div className="overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Descartar {count} carta(s) — {PLAYER_LABEL[color]}</h3>
        <p className="muted-note">Selecionadas: {total}/{count}</p>
        <div className="trade-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div>
            {RESOURCES.map((r) => (
              <div key={r} className="trade-row">
                <span>{RESOURCE_ICON[r]} {RESOURCE_LABEL[r]} ({hand[r]})</span>
                {/* Não deixa passar do necessário: o + trava ao atingir `count`
                    (diminua um recurso para liberar outro). */}
                <Stepper value={picks[r]} max={Math.min(hand[r], picks[r] + Math.max(0, count - total))} onChange={(v) => setPicks((p) => ({ ...p, [r]: v }))} />
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="primary" disabled={total !== count} onClick={() => onDiscard(picks)}>Descartar</button>
        </div>
      </div>
    </div>
  );
}


function getPlayer(state: GameState, color: PlayerColor) {
  return state.players.find((p) => p.color === color)!;
}

/** Placar final (pontos públicos, maior primeiro) — usado na tela de fim e na imagem. */
function standingsOf(state: GameState): { color: PlayerColor; name: string; pts: number }[] {
  return state.players
    .map((p) => ({ color: p.color, name: p.name, pts: publicScoreOf(state, p.color) }))
    .sort((a, b) => b.pts - a.pts);
}

/**
 * Tela de fim de jogo (não existia): pódio + placar + botão de COMPARTILHAR uma
 * imagem do resultado (Colonist v195 — marketing orgânico). Usa a Web Share API
 * quando disponível (celular), senão baixa o PNG.
 */
function EndGameOverlay({
  state, localColor, elapsed, turns, onExit, botColors, awayColors, viewerColor, onPlayer,
}: {
  state: GameState;
  localColor: PlayerColor;
  elapsed: number;
  turns: number;
  onExit: () => void;
  botColors: PlayerColor[];
  awayColors: PlayerColor[];
  viewerColor: PlayerColor | null;
  onPlayer: (username: string, x: number, y: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const winner = state.winner!;
  const winnerName = getPlayer(state, winner).name;
  const iWon = winner === localColor;
  const standings = standingsOf(state);

  async function share() {
    setBusy(true);
    try {
      const blob = await renderResultBlob(state, elapsed, turns);
      if (!blob) return;
      const file = new File([blob], 'trevalis-resultado.png', { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> };
      const text = `🏆 ${winnerName} venceu no Trevalis! Jogue em trevalis.app`;
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        try { await nav.share({ files: [file], title: 'Trevalis', text }); return; } catch { /* usuário cancelou / não suportado: baixa */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'trevalis-resultado.png';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay endgame-overlay">
      <div className="modal endgame-modal" onClick={(e) => e.stopPropagation()}>
        <div className="endgame-crown" style={{ background: PLAYER_FILL[winner] }}><Trophy size={30} /></div>
        <h3 className="endgame-title">{iWon ? 'Você venceu!' : `${winnerName} venceu!`}</h3>
        <p className="muted-note endgame-sub">{fmtTime(elapsed)} · {turns} turnos</p>
        <div className="endgame-standings">
          {standings.map((s, i) => {
            const human = !botColors.includes(s.color) && !awayColors.includes(s.color) && s.color !== viewerColor;
            return (
              <div key={s.color} className={`endgame-row${s.color === winner ? ' win' : ''}`}>
                <span className="endgame-rank">{i + 1}º</span>
                <span className="swatch" style={{ background: PLAYER_FILL[s.color] }} />
                {human ? (
                  <button className="endgame-nm as-link" title="Opções do jogador"
                    onClick={(e) => onPlayer(s.name, e.clientX, e.clientY)}>{s.name}</button>
                ) : (
                  <span className="endgame-nm">{s.name}{s.color === localColor && <small className="you-tag"> você</small>}</span>
                )}
                <b className="endgame-pts">{s.pts} pts</b>
              </div>
            );
          })}
        </div>
        <div className="modal-actions endgame-actions">
          <button className="primary" onClick={share} disabled={busy}>
            {navigatorCanShare() ? <Share2 size={15} /> : <Download size={15} />} {busy ? 'Gerando…' : 'Compartilhar resultado'}
          </button>
          <button onClick={onExit}><LogOut size={15} /> Sair</button>
        </div>
      </div>
    </div>
  );
}

function navigatorCanShare(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as { share?: unknown }).share === 'function';
}

/** Desenha um cartão de resultado (1200×630, formato de social card) e devolve um PNG. */
function renderResultBlob(state: GameState, elapsed: number, turns: number): Promise<Blob | null> {
  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);

  // Fundo creme + moldura coral.
  ctx.fillStyle = '#f6f0e7';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#c0563a';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, W - 28, H - 28);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#8a7a64';
  ctx.font = '700 26px Georgia, serif';
  ctx.fillText('TREVALIS', 60, 78);

  const winner = state.winner!;
  const winnerName = getPlayer(state, winner).name;
  ctx.fillStyle = '#362e24';
  ctx.font = '700 62px Georgia, serif';
  ctx.fillText(`🏆 ${winnerName} venceu!`, 60, 150);

  ctx.fillStyle = '#8a7a64';
  ctx.font = '400 26px Georgia, serif';
  ctx.fillText(`${fmtTime(elapsed)} de partida · ${turns} turnos`, 60, 196);

  // Placar.
  const standings = standingsOf(state);
  let y = 262;
  for (let i = 0; i < standings.length && i < 8; i++) {
    const s = standings[i]!;
    ctx.fillStyle = '#8a7a64';
    ctx.font = '700 30px Georgia, serif';
    ctx.fillText(`${i + 1}º`, 60, y);
    ctx.fillStyle = PLAYER_FILL[s.color];
    ctx.fillRect(112, y - 26, 30, 30);
    ctx.fillStyle = '#362e24';
    ctx.font = `${s.color === winner ? '700' : '400'} 32px Georgia, serif`;
    ctx.fillText(s.name, 160, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${s.pts} pts`, W - 70, y);
    ctx.textAlign = 'left';
    y += 46;
  }

  ctx.fillStyle = '#c0563a';
  ctx.font = '700 28px Georgia, serif';
  ctx.fillText('Jogue em trevalis.app', 60, H - 46);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

// ---- Animação (coordenadas em tela) ----
function raf2(cb: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

function svgScreen(svg: SVGSVGElement, x: number, y: number): Pt {
  const ctm = svg.getScreenCTM();
  if (!ctm) {
    const r = svg.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  const p = svg.createSVGPoint();
  p.x = x;
  p.y = y;
  const s = p.matrixTransform(ctm);
  return { x: s.x, y: s.y };
}

function anchorCenter(selector: string): Pt | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Onde fica a "mão" do jogador na tela: minha mão, ou o avatar dele nos Nobres. */
function destForOwner(color: PlayerColor, localColor: PlayerColor): Pt | null {
  if (color === localColor) return anchorCenter('.hand-cards');
  return anchorCenter(`[data-noble="${color}"]`);
}

/**
 * Destino de uma carta ganha: para mim, a pilha exata daquele recurso na mão
 * (assim a carta pousa onde ela fica de fato); para outro, o avatar dele.
 */
function handDest(resource: Resource, owner: PlayerColor, localColor: PlayerColor): Pt | null {
  if (owner !== localColor) return anchorCenter(`[data-noble="${owner}"]`);
  return anchorCenter(`.hand-cards [data-card="${resource}"]`) ?? anchorCenter('.hand-cards');
}

type FlyFn = (opts: FlyOpts) => void;
type BlockerMovedEvent = Extract<GameEvent, { t: 'blockerMoved' }>;

/** Ganho de recurso: de cada hex que casa a soma dos dados -> mão (minha) ou avatar do dono. */
function animateProduced(fly: FlyFn, svg: SVGSVGElement, producedSum: number, newState: GameState, localColor: PlayerColor): void {
  let delay = 0;
  for (const hid of newState.board.hexOrder) {
    const hex = newState.board.hexes[hid]!;
    if (hex.number !== producedSum || newState.blocker.hexId === hid) continue;
    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (!resource) continue;
    const from = svgScreen(svg, hex.cx, hex.cy);
    for (const vid of hex.corners) {
      const b = newState.buildings[vid];
      if (!b) continue;
      const to = handDest(resource, b.owner, localColor);
      if (!to) continue;
      const n = b.kind === 'city' ? 2 : 1;
      for (let k = 0; k < n; k++) {
        fly({ kind: 'card', img: RES_IMG[resource], from, to, delay });
        delay += 70;
      }
    }
  }
}

/** Ladrão: movimento do hex antigo para o novo (desenhado em cy-26). */
function animateRobberMove(fly: FlyFn, svg: SVGSVGElement, moved: BlockerMovedEvent, prevBlocker: string, newState: GameState): void {
  if (prevBlocker === moved.hexId) return;
  const a = newState.board.hexes[prevBlocker];
  const b = newState.board.hexes[moved.hexId];
  if (a && b) fly({ kind: 'robber', from: svgScreen(svg, a.cx, a.cy - 26), to: svgScreen(svg, b.cx, b.cy - 26), duration: 650 });
}

/** Roubo pelo ladrão: carta da vítima -> quem moveu o ladrão (após o ladrão pousar). */
function animateSteal(fly: FlyFn, moved: BlockerMovedEvent, localColor: PlayerColor): void {
  if (!moved.stoleFrom || !moved.resource) return;
  const from = destForOwner(moved.stoleFrom, localColor);
  const to = destForOwner(moved.by, localColor);
  if (from && to) fly({ kind: 'card', img: RES_IMG[moved.resource], from, to, delay: 380, duration: 560 });
}

/** Gasto/descarte de um jogador: mão (ou avatar) -> Banco. */
function animateSpend(fly: FlyFn, owner: PlayerColor, spend: Partial<Record<Resource, number>>, localColor: PlayerColor): void {
  const from = destForOwner(owner, localColor);
  const to = anchorCenter('[data-anchor="bank"]');
  if (!from || !to) return;
  let delay = 0;
  for (const r of RESOURCES) {
    for (let k = 0; k < (spend[r] ?? 0); k++) {
      fly({ kind: 'card', img: RES_IMG[r], from, to, delay });
      delay += 70;
    }
  }
}

/**
 * Recursos gastos POR DONO derivados só dos eventos (modo online, que não expõe a
 * `action`): construção (custo por tipo), compra de carta e troca com o banco.
 */
function spentByOwnerFromEvents(events: GameEvent[]): { owner: PlayerColor; spend: Partial<Record<Resource, number>> }[] {
  const out: { owner: PlayerColor; spend: Partial<Record<Resource, number>> }[] = [];
  for (const e of events) {
    if (e.t === 'built') {
      const cost = e.kind === 'road' ? COSTS.road : e.kind === 'settlement' ? COSTS.settlement : COSTS.city;
      out.push({ owner: e.owner, spend: cost });
    } else if (e.t === 'progressCardBought') {
      out.push({ owner: e.owner, spend: COSTS.progressCard });
    } else if (e.t === 'bankTrade') {
      out.push({ owner: e.owner, spend: { [e.give]: e.rate } });
    }
  }
  return out;
}

function phaseLabel(state: GameState): string {
  switch (state.phase) {
    case 'setup1':
    case 'setup2':
      return 'Setup';
    case 'roll':
      return 'Rolar dados';
    case 'main':
      return 'Ações';
    case 'discard':
      return 'Descarte (7)';
    case 'moveBlocker':
      return 'Mover bloqueador';
    case 'ended':
      return 'Fim';
    default:
      return '';
  }
}

/** Manchete serifada da barra central do tabuleiro. */
function headline(state: GameState, myTurn: boolean, botTurn: boolean, curName: string): string {
  if (state.phase === 'ended') return `🏆 ${PLAYER_LABEL[state.winner!]} venceu!`;
  if (state.phase === 'discard') return 'Descarte o excesso de cartas';
  if (botTurn) return `${curName} está jogando…`;
  if (!myTurn) return 'Aguardando…';
  if (state.phase === 'moveBlocker') return 'Mova o ladrão pela ilha';
  if (state.phase === 'setup1' || state.phase === 'setup2') {
    return state.setupLastVertex ? 'Posicione sua estrada' : 'Posicione sua vila';
  }
  if (state.phase === 'roll') return 'Role os dados do destino';
  if (state.phase === 'main') return 'Erga o seu reino';
  return '';
}

function TitleCard({ icon, title, owner, earned, hint }: { icon: ReactNode; title: string; owner: string; earned: boolean; hint: string }) {
  return (
    <div className={`title-card${earned ? ' earned' : ''}`}>
      <span className="tc-icon">{icon}</span>
      <div className="tc-body">
        <div className="tc-head">
          <b>{title}</b>
          {earned && <span className="tc-pv"><Trophy size={10} /> +2 PV</span>}
        </div>
        <div className="tc-owner">{owner}</div>
        <div className="tc-hint">{hint}</div>
      </div>
    </div>
  );
}

function Stat({ icon, label, hl }: { icon: ReactNode; label: string; hl?: boolean }) {
  return <span className={`nstat${hl ? ' hl' : ''}`}>{icon} {label}</span>;
}

function TitleBadge({ icon, label }: { icon: ReactNode; label: string }) {
  return <span className="title-badge">{icon} {label} <Trophy size={10} /> +2</span>;
}

export interface NameColor {
  name: string;
  color: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pinta os NOMES dos jogadores (na cor de cada um) em negrito numa linha de log. */
function colorizeNames(text: string, names: NameColor[]): ReactNode[] {
  const valid = names.filter((n) => n.name.trim().length > 0);
  if (valid.length === 0) return [<span key={0}>{text}</span>];
  // Nomes maiores primeiro para evitar casar um prefixo de outro.
  const ordered = [...valid].sort((a, b) => b.name.length - a.name.length);
  const re = new RegExp(`(${ordered.map((n) => escapeRe(n.name)).join('|')})`, 'g');
  return text.split(re).map((part, i) => {
    const m = valid.find((n) => n.name === part);
    return m ? <b key={i} style={{ color: m.color }}>{part}</b> : <span key={i}>{part}</span>;
  });
}

function LogLine({ entry, names }: { entry: LogEntry; names: NameColor[] }) {
  if (entry.kind === 'sep') return <div className="log-sep" />;
  return <div className="log-line">{colorizeNames(entry.text, names)}</div>;
}

function soundForEvent(e: GameEvent): SoundKind | null {
  switch (e.t) {
    case 'diceRolled':
      return 'dice';
    case 'built':
      return e.kind; // 'road' | 'settlement' | 'city'
    case 'progressCardBought':
    case 'cardPlayed':
      return 'card';
    case 'blockerMoved':
      return 'robber';
    case 'bankTrade':
    case 'tradeExecuted':
    case 'tradeProposed':
    case 'tradeCountered':
      return null; // sem som de comércio
    case 'longestRoad':
      return e.owner ? 'longestRoad' : null;
    case 'largestArmy':
      return e.owner ? 'largestArmy' : null;
    case 'gameWon':
      return 'win';
    default:
      return null;
  }
}

function toastForEvent(e: GameEvent, state: GameState): { text: string; tone: ToastTone } | null {
  switch (e.t) {
    case 'produced': {
      const g = e.gains[state.currentPlayer];
      const items = (Object.entries(g) as [Resource, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${n}${RESOURCE_ICON[r]}`);
      return items.length ? { text: `Você recebeu ${items.join(' ')}`, tone: 'good' } : null;
    }
    case 'cardPlayed':
      return { text: `${PLAYER_LABEL[e.owner]} jogou ${CARD_LABEL[e.card]}`, tone: 'info' };
    case 'monopoly':
      return { text: `${PLAYER_LABEL[e.owner]} monopolizou ${RESOURCE_LABEL[e.resource]} (+${e.taken})`, tone: 'warn' };
    case 'blockerMoved':
      return e.stoleFrom ? { text: `Roubo de ${PLAYER_LABEL[e.stoleFrom]}`, tone: 'warn' } : null;
    case 'tradeExecuted':
      return { text: `Troca fechada: ${PLAYER_LABEL[e.from]} ↔ ${PLAYER_LABEL[e.with]}`, tone: 'good' };
    case 'longestRoad':
      return e.owner ? { text: `📏 Estrada Mais Longa: ${PLAYER_LABEL[e.owner]}`, tone: 'good' } : null;
    case 'largestArmy':
      return e.owner ? { text: `⚔️ Maior Exército: ${PLAYER_LABEL[e.owner]}`, tone: 'good' } : null;
    case 'turnEnded':
      return { text: `Vez de ${PLAYER_LABEL[e.next]}`, tone: 'info' };
    case 'gameWon':
      return { text: `🏆 ${PLAYER_LABEL[e.winner]} venceu!`, tone: 'good' };
    default:
      return null;
  }
}

/** Nome do jogador (cai no rotulo da cor se nao achar). */
function nm(state: GameState, color: PlayerColor): string {
  return state.players.find((p) => p.color === color)?.name ?? PLAYER_LABEL[color];
}

function describeEvent(e: GameEvent, state: GameState): string {
  switch (e.t) {
    case 'diceRolled':
      return `🎲 ${e.dice[0]} + ${e.dice[1]} = ${e.sum}`;
    case 'produced': {
      const parts: string[] = [];
      for (const p of state.players) {
        const g = e.gains[p.color];
        const items = (Object.entries(g) as [Resource, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${n}${RESOURCE_ICON[r]}`);
        if (items.length) parts.push(`${p.name}: ${items.join(' ')}`);
      }
      return parts.length ? `Produção — ${parts.join(' · ')}` : 'Produção — nada';
    }
    case 'built':
      return `${nm(state, e.owner)} construiu ${{ road: 'estrada', settlement: 'vila', city: 'cidade' }[e.kind]}`;
    case 'progressCardBought':
      return `${nm(state, e.owner)} comprou uma carta de progresso`;
    case 'cardPlayed':
      return `${nm(state, e.owner)} jogou ${CARD_LABEL[e.card]}`;
    case 'monopoly':
      return `📦 ${nm(state, e.owner)} monopolizou ${RESOURCE_LABEL[e.resource]} (+${e.taken})`;
    case 'blockerMoved':
      return e.stoleFrom ? `Bloqueador movido — roubou de ${nm(state, e.stoleFrom)}` : 'Bloqueador movido';
    case 'mustDiscard':
      return `Rolou 7 — descarte: ${e.players.map((p) => nm(state, p.color)).join(', ')}`;
    case 'discarded':
      return `${nm(state, e.owner)} descartou`;
    case 'bankTrade':
      return `${nm(state, e.owner)} trocou ${e.rate} ${RESOURCE_LABEL[e.give]} por 1 ${RESOURCE_LABEL[e.want]}`;
    case 'tradeProposed':
      return `🤝 ${nm(state, e.from)} propôs uma troca`;
    case 'tradeCountered':
      return `↩ ${nm(state, e.from)} fez uma contraproposta`;
    case 'tradeResponded':
      return `${nm(state, e.player)} ${e.accept ? 'aceitou' : 'recusou'} a troca`;
    case 'tradeExecuted':
      return `✅ Troca: ${nm(state, e.from)} ↔ ${nm(state, e.with)}`;
    case 'tradeCancelled':
      return 'Troca cancelada';
    case 'longestRoad':
      return e.owner ? `📏 Estrada Mais Longa: ${nm(state, e.owner)}` : 'Estrada Mais Longa perdida';
    case 'largestArmy':
      return e.owner ? `⚔️ Maior Exército: ${nm(state, e.owner)}` : 'Maior Exército perdido';
    case 'turnEnded':
      return `▶ Vez de ${nm(state, e.next)}`;
    case 'gameWon':
      return `🏆 ${nm(state, e.winner)} venceu!`;
    default:
      return '';
  }
}

const CARD_LABEL: Record<ProgressCard, string> = {
  knight: 'Cavaleiro',
  roadBuilding: '2 Estradas',
  yearOfPlenty: '+2 Recursos',
  monopoly: 'Monopólio',
  victoryPoint: 'Ponto de Vitória',
};
