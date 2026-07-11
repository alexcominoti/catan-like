import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  publicScoreOf,
  scoreOf,
  handSize,
  robberVictims,
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
  Volume2, VolumeX, HelpCircle, LogOut, Share2, Download, Ban, X,
} from 'lucide-react';
import { suggestSetupSettlement } from '@trevalis/bot';
import { Board, type InteractionMode } from './board/Board.js';
import { Dice } from './ui/Dice.js';
import { HandBar } from './ui/HandBar.js';
import { useFlyer, FlyLayer, type Pt, type FlyOpts } from './ui/FlyLayer.js';
import { RES_IMG, DEV_IMG } from './game/cards.js';
import { Toasts, useToasts, type ToastTone } from './ui/Toasts.js';
import { play as playSound, setMuted, unlockAudio, nudgeVolume, type SoundKind } from './ui/sound.js';
import type { GameClient, ChatMessage } from './net/client.js';
import { PlayerMenu, useRelationships } from './site/PlayerMenu.js';
import { PLAYER_FILL, RESOURCE_ICON } from './game/theme.js';
import { useT, type MsgKey } from './i18n/index.js';

/** Assinatura da função de tradução, para passar aos helpers de módulo. */
type TFn = (key: MsgKey, params?: Record<string, string | number>) => string;
const colorLabel = (t: TFn, c: PlayerColor) => t(`color.${c}` as MsgKey);
const resLabel = (t: TFn, r: Resource) => t(`resource.${r}` as MsgKey);
const cardLabel = (t: TFn, c: ProgressCard) => t(`card.${c}` as MsgKey);

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
  /** Mensagens de chat da partida (networked; acumuladas pelo RoomScreen). */
  chat: ChatMessage[];
}

function fmtSecs(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

type LogEntry =
  | { kind: 'event'; text: string }
  | { kind: 'sep' };

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
  const t = useT();
  // O estado é sempre controlado pelo RoomScreen a partir das mensagens do servidor.
  const state = online.state;
  const [log, setLog] = useState<LogEntry[]>(() => [{ kind: 'event', text: t('game.matchStarted') }]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<InteractionMode>('idle');
  const [give, setGive] = useState<Resource>('wood');
  const [want, setWant] = useState<Resource>('brick');
  const [arming, setArming] = useState<'yearOfPlenty' | 'monopoly' | 'trade' | 'counter' | null>(null);
  const [tradeGive, setTradeGive] = useState<Record<Resource, number>>(zeroRes);
  const [tradeWant, setTradeWant] = useState<Record<Resource, number>>(zeroRes);
  const [tradeAny, setTradeAny] = useState(0); // carta coringa: nº de recursos "quaisquer" pedidos
  // Oferta coringa a resolver ao aceitar (o aceitante escolhe quais recursos dar).
  const [wildcard, setWildcard] = useState<NonNullable<GameState['activeTrade']> | null>(null);
  // Troca RECUSADA por mim: escondida localmente (a oferta segue ativa no servidor
  // até o proponente resolver/expirar) para o popup não reaparecer a cada estado.
  const [dismissedTradeKey, setDismissedTradeKey] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // Fim de jogo: permite FECHAR o placar para inspecionar o tabuleiro (só leitura)
  // e reabrir depois. Ao terminar, o board já fica não-interativo (effMode 'idle').
  const [resultsDismissed, setResultsDismissed] = useState(false);
  // Quando o ladrao pode roubar de 2+ jogadores, o humano escolhe a vitima.
  const [robberChoice, setRobberChoice] = useState<{ hexId: string; victims: PlayerColor[] } | null>(null);
  // Confirmacao antes de construir.
  const [muted, setMutedState] = useState(false);
  const [elapsed, setElapsed] = useState(0); // cronometro da partida (segundos)
  const [turnCount, setTurnCount] = useState(1); // contador de turno
  const [chatInput, setChatInput] = useState('');
  // Menu de jogador (clicar no nome): perfil / amigo / bloquear. + minhas relações
  // (para o estado do botão de amizade e para esconder mensagens de bloqueados).
  const { data: relations, refresh: refreshRelations, blockedNames } = useRelationships();
  const [playerMenu, setPlayerMenu] = useState<{ username: string; x: number; y: number } | null>(null);
  // Silenciados (mute) no jogo: client-side, por nome (esconde o chat deles).
  const [mutedNames, setMutedNames] = useState<Set<string>>(new Set());
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
    const msg = chatInput.trim();
    if (!msg || isSpectator) return; // só jogadores enviam; o servidor faz o broadcast
    online.client.sendChat(msg);
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
      .map((e) => describeEvent(e, newState, t))
      .filter(Boolean)
      .map((text) => ({ kind: 'event' as const, text }));
    const sep: LogEntry[] = events.some((e) => e.t === 'turnEnded') ? [{ kind: 'sep' as const }] : [];
    setLog((prev) => [...lines, ...sep, ...prev].slice(0, 200));
    for (const e of events) {
      const toast = toastForEvent(e, newState, t);
      if (toast) push(toast.text, toast.tone);
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
    // Mesma regra do servidor (robberVictims respeita o fog of war via hiddenHand).
    // O servidor rouba sozinho quando ha 1 alvo; aqui so perguntamos se ha 2+.
    const victims = robberVictims(state, hid, state.currentPlayer);
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
          e.preventDefault(); push(t('game.volume', { pct: Math.round(nudgeVolume(0.1) * 100) }), 'info');
          break;
        case 'ArrowDown':
          e.preventDefault(); push(t('game.volume', { pct: Math.round(nudgeVolume(-0.1) * 100) }), 'info');
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
        <span className="turn-chip"><Clock size={13} /> {t('game.turn', { n: turnCount })}</span>
        <div className="game-header-actions">
          <button className="hbtn icon-only" title={muted ? t('game.soundOff') : t('game.soundOn')} onClick={() => { const m = !muted; setMutedState(m); setMuted(m); }}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
          <button className="hbtn" onClick={() => setHelp(true)}><HelpCircle size={15} /> {t('game.help')}</button>
          <button className="ghost" onClick={onExit}><LogOut size={15} /> {t('game.exit')}</button>
        </div>
      </header>

      <div className="game-body">
        {/* ESQUERDA — Nobres */}
        <aside className="nobres">
          <div className="nobres-head">
            <h2><Crown size={18} className="ic-primary" /> {t('game.nobles')}</h2>
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
                  {/* Durante o jogo mostra o placar PÚBLICO (esconde cartas de PV);
                      no fim, o estado é revelado e mostramos a pontuação real. */}
                  <div className="noble-pts"><b>{state.phase === 'ended' ? scoreOf(state, p.color) : publicScoreOf(state, p.color)}</b><span>pts</span></div>
                </div>
                <div className="noble-main">
                  <div className="noble-name">
                    {/* Opções de jogador (perfil/amizade/bloquear) só para HUMANOS —
                        nunca para bots nem assentos controlados por bot ("🤖 assumiu"). */}
                    {(!isBot(p.color) && p.color !== online.viewerColor) ? (
                      <button className="noble-nick as-link" title={t('game.playerOptions')}
                        onClick={(e) => setPlayerMenu({ username: p.name, x: e.clientX, y: e.clientY })}>{p.name}</button>
                    ) : (
                      <span className="noble-nick">{p.name}</span>
                    )}
                    {!isSpectator && p.color === localColor && <span className="you-tag">{t('game.you')}</span>}
                    {online && online.awayColors.includes(p.color) ? (
                      <span className="bot-tag" title={t('game.botTookOverTitle')}>{t('game.botTookOver')}</span>
                    ) : (
                      isBot(p.color) && <span className="bot-tag">{t('game.bot')}</span>
                    )}
                    {!isSpectator && p.color !== localColor && (() => {
                      const on = (state.embargoes ?? []).some((e) => e.by === localColor && e.target === p.color);
                      return (
                        <button className={`embargo-btn${on ? ' on' : ''}`}
                          title={on ? t('game.embargoOn') : t('game.embargoOff')}
                          onClick={() => dispatch({ t: 'setEmbargo', target: p.color, on: !on })}>
                          <Ban size={12} />
                        </button>
                      );
                    })()}
                  </div>
                  <div className="noble-stats">
                    {/* Oponentes vêm com mão/cartas OCULTAS na projeção; mostramos a
                        CONTAGEM (handSize usa hiddenHand; hiddenDevCount), não 0. */}
                    <Stat icon={<Layers size={12} />} label={t('game.stat.resources', { n: handSize(p) })} />
                    <Stat icon={<Sparkles size={12} />} label={t('game.stat.dev', { n: p.hiddenDevCount ?? p.progressCards.length })} />
                    <Stat icon={<Scroll size={12} />} label={t('game.stat.roads', { n: longestRoadLength(state, p.color) })} hl={hasRoad} />
                    <Stat icon={<Swords size={12} />} label={t('game.stat.knights', { n: p.knightsPlayed })} hl={hasArmy} />
                  </div>
                  {(hasRoad || hasArmy) && (
                    <div className="noble-badges">
                      {hasRoad && <TitleBadge icon={<Scroll size={11} />} label={t('game.longestRoad')} />}
                      {hasArmy && <TitleBadge icon={<Swords size={11} />} label={t('game.largestArmy')} />}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div className="title-cards">
            <TitleCard icon={<Scroll size={15} className="ic-primary" />} title={t('game.longestRoad')}
              owner={state.longestRoad.owner ? t('game.roadOwner', { name: colorLabel(t, state.longestRoad.owner), n: state.longestRoad.length }) : t('game.inDispute')}
              earned={!!state.longestRoad.owner} hint={t('game.longestRoadHint')} />
            <TitleCard icon={<Swords size={15} className="ic-primary" />} title={t('game.largestArmy')}
              owner={state.largestArmy.owner ? t('game.armyOwner', { name: colorLabel(t, state.largestArmy.owner), n: state.largestArmy.size }) : t('game.inDispute')}
              earned={!!state.largestArmy.owner} hint={t('game.largestArmyHint')} />
          </div>
        </aside>

        {/* CENTRO — tabuleiro + mão */}
        <main className="center">
          <div className="center-top">
            <div>
              <p className="eyebrow-turn">{myTurn ? t('game.yourTurn') : botTurn ? t('game.turnOf', { name: cur.name }) : t('game.waiting')}</p>
              <h2>{headline(state, myTurn, botTurn, cur.name, t)}</h2>
            </div>
            {secsLeft != null && (
              <div className={`turn-timer${secsLeft <= 5 ? ' danger' : ''}`} title={t('game.turnTimeTitle')}>
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
                <Dices size={16} /> {t('game.rollDice')}
              </button>
            )}
          </div>

          <div className="center-hand">
            <div className="hand-head">
              <div>
                <p className="eyebrow">{t('game.yourHand')}</p>
                <p className="hand-count">
                  {t('game.cards', { n: resourceCount + localPlayer.progressCards.length })}
                  <span className="muted-note"> {t('game.resourcesParens', { n: resourceCount })}</span>
                  {resourceCount > state.discardLimit && <span className="over-limit">{t('game.overLimit')}</span>}
                </p>
              </div>
              <div className="hand-actions">
                <BuildButton label={t('game.btn.road')} cost={COSTS.road} active={mode === 'buildRoad'} hand={localPlayer.hand}
                  stock={localPlayer.pieces.roads}
                  enabled={myMain && (canAffordUI(localPlayer.hand, COSTS.road) || state.pendingFreeRoads > 0) && localPlayer.pieces.roads > 0}
                  free={state.pendingFreeRoads > 0} onClick={() => toggle('buildRoad')} t={t} />
                <BuildButton label={t('game.btn.settlement')} cost={COSTS.settlement} active={mode === 'buildSettlement'} hand={localPlayer.hand}
                  stock={localPlayer.pieces.settlements}
                  enabled={myMain && canAffordUI(localPlayer.hand, COSTS.settlement) && localPlayer.pieces.settlements > 0}
                  onClick={() => toggle('buildSettlement')} t={t} />
                <BuildButton label={t('game.btn.city')} cost={COSTS.city} active={mode === 'buildCity'} hand={localPlayer.hand}
                  stock={localPlayer.pieces.cities}
                  enabled={myMain && canAffordUI(localPlayer.hand, COSTS.city) && localPlayer.pieces.cities > 0}
                  onClick={() => toggle('buildCity')} t={t} />
                <BuildButton label={t('game.btn.card')} cost={COSTS.progressCard} hand={localPlayer.hand}
                  stock={state.devDeckCount ?? state.devDeck.length}
                  enabled={myMain && canAffordUI(localPlayer.hand, COSTS.progressCard) && (state.devDeckCount ?? state.devDeck.length) > 0}
                  onClick={() => dispatch({ t: 'buyProgressCard' })} t={t} />
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
                <button className="hbtn" disabled={!myMain || !!state.activeTrade} onClick={() => setArming('trade')}><ArrowLeftRight size={14} /> {t('game.trade')}</button>
                <button className="hbtn primary-soft" disabled={!myMain} onClick={() => dispatch({ t: 'endTurn' })}><Hand size={14} /> {t('game.pass')}</button>
              </div>
            </div>
            <div className="hand-error">{error && <>⚠ {error}</>}</div>
            <HandBar hand={localPlayer.hand} devCards={localPlayer.progressCards} canPlay={canPlay} onPlay={playCard} />
          </div>
        </main>

        {/* DIREITA — Pergaminho (log) + Chat + Banco */}
        <aside className="pergaminho">
          <div className="card scroll-card">
            <h2><MessageSquare size={16} className="ic-primary" /> {t('game.scroll')}</h2>
            <div className="log">{log.map((entry, i) => <LogLine key={i} entry={entry} names={logNames} />)}</div>
          </div>

          <div className="card chat-card">
            <h3 className="chat-head"><MessageSquare size={14} className="ic-primary" /> {t('game.chat')}</h3>
            <div className="chat-log">
              {(() => {
                // Esconde mensagens de quem eu BLOQUEEI (persistente) ou SILENCIEI (no jogo).
                const visible = online.chat.filter(
                  (m) => !blockedNames.has(m.name.toLowerCase()) && !mutedNames.has(m.name.toLowerCase()),
                );
                if (visible.length === 0) return <p className="muted-note">{t('game.noMessages')}</p>;
                return [...visible].reverse().map((m, i) => (
                  <div key={i} className="log-chat"><b style={{ color: m.from ? PLAYER_FILL[m.from] : 'var(--muted)' }}>{m.name}:</b> {m.text}</div>
                ));
              })()}
            </div>
            <div className="chat-row">
              <input value={chatInput} maxLength={200} disabled={isSpectator}
                placeholder={isSpectator ? t('game.spectatorNoChat') : t('game.messagePlaceholder')}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }} />
              <button onClick={sendChat} disabled={isSpectator} aria-label={t('game.send')}><Send size={15} /></button>
            </div>
          </div>

          <div className="card bank-card" data-anchor="bank">
            <h2><Landmark size={16} className="ic-primary" /> {t('game.bank')}</h2>
            <div className="bank-grid">
              {RESOURCES.map((r) => (
                <div key={r} className="bank-pile" title={resLabel(t, r)}>
                  <img src={RES_IMG[r]} alt={resLabel(t, r)} />
                  <span className="card-count">{state.bank[r]}</span>
                </div>
              ))}
              <div className="bank-pile" title={t('game.devDeckTitle')}>
                <img src={DEV_IMG.victoryPoint} alt={t('game.devAlt')} />
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
        <ResourcePickerModal title={t('game.monopolyPick')}
          onPick={(r) => dispatch({ t: 'playMonopoly', resource: r })} onClose={() => setArming(null)} />
      )}
      {arming === 'yearOfPlenty' && (
        <YearOfPlentyModal
          state={state}
          onConfirm={(resources) => { dispatch({ t: 'playYearOfPlenty', resources }); setArming(null); }}
          onClose={() => setArming(null)} />
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
      {state.phase === 'ended' && state.winner && !resultsDismissed && (
        <EndGameOverlay state={state} localColor={localColor} elapsed={elapsed} turns={turnCount} onExit={onExit}
          botColors={online.bots} awayColors={online.awayColors} viewerColor={online.viewerColor}
          onClose={() => setResultsDismissed(true)}
          onPlayer={(username, x, y) => setPlayerMenu({ username, x, y })} />
      )}
      {state.phase === 'ended' && state.winner && resultsDismissed && (
        <button className="reopen-result" onClick={() => setResultsDismissed(false)}>
          <Trophy size={15} /> {t('game.viewResult')}
        </button>
      )}
      {playerMenu && (
        <PlayerMenu username={playerMenu.username} data={relations} x={playerMenu.x} y={playerMenu.y}
          onAction={refreshRelations} onClose={() => setPlayerMenu(null)}
          muted={mutedNames.has(playerMenu.username.toLowerCase())}
          onToggleMute={() => setMutedNames((prev) => {
            const next = new Set(prev);
            const key = playerMenu.username.toLowerCase();
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
          })} />
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
  stock,
  onClick,
  t,
}: {
  label: string;
  cost: Partial<Record<Resource, number>>;
  active?: boolean;
  enabled: boolean;
  free?: boolean;
  hand: Record<Resource, number>;
  /** Peças restantes no estoque (vilas/cidades/estradas; ou cartas no baralho). */
  stock: number;
  onClick: () => void;
  t: TFn;
}) {
  const outOfStock = stock <= 0;
  const affordable = canAffordUI(hand, cost) || free;
  return (
    <button
      className={`build-btn${active ? ' active' : ''}${outOfStock ? ' no-stock' : ''}`}
      disabled={!enabled}
      onClick={onClick}
      title={t('game.costStock', { icons: costIcons(cost), n: stock })}
    >
      <span className="build-label">{label}<span className="build-stock">{stock}</span></span>
      <small className={outOfStock ? 'no-stock-note' : affordable ? '' : 'short'}>
        {outOfStock ? t('game.noStock') : free ? t('game.free') : costIcons(cost)}
      </small>
    </button>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const terr: [string, string, string][] = [
    ['🌲', 'terrain.forest', 'resource.wood'],
    ['🧱', 'terrain.hills', 'resource.brick'],
    ['🐑', 'terrain.pasture', 'resource.wool'],
    ['🌾', 'terrain.field', 'resource.grain'],
    ['⛰️', 'terrain.mountain', 'resource.ore'],
  ];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('game.help.title')}</h3>
        <h4>{t('game.help.terrains')}</h4>
        <ul className="help-list">{terr.map(([icon, tk, rk]) => (
          <li key={tk}>{icon} {t('game.help.terrainArrow', { terrain: t(tk as MsgKey), resource: t(rk as MsgKey) })}</li>
        ))}</ul>
        <h4>{t('game.help.costs')}</h4>
        <ul className="help-list">
          <li>{t('game.btn.road')}: {costIcons(COSTS.road)}</li>
          <li>{t('game.btn.settlement')}: {costIcons(COSTS.settlement)}</li>
          <li>{t('game.btn.city')}: {costIcons(COSTS.city)}</li>
          <li>{t('game.btn.card')}: {costIcons(COSTS.progressCard)}</li>
        </ul>
        <h4>{t('game.help.ports')}</h4>
        <p className="muted-note">{t('game.help.portsText')}</p>
        <h4>{t('game.help.controls')}</h4>
        <p className="muted-note">{t('game.help.controlsText')}</p>
        <h4>{t('game.help.shortcuts')}</h4>
        <ul className="help-list">
          <li><b>{t('game.help.keySpace')}</b> — {t('game.help.sc1')}</li>
          <li><b>M</b> — {t('game.help.sc2')} · <b>↑ / ↓</b> — {t('game.help.scVolume')}</li>
          <li><b>F</b> — {t('game.help.sc3full')} · <b>ESC</b> — {t('game.help.scEsc')}</li>
        </ul>
        <button className="link" onClick={onClose}>{t('game.help.close')}</button>
      </div>
    </div>
  );
}

function ResourcePickerModal({ title, onPick, onClose }: { title: string; onPick: (r: Resource) => void; onClose: () => void }) {
  const t = useT();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="hand">
          {RESOURCES.map((r) => <button key={r} onClick={() => onPick(r)}>{RESOURCE_ICON[r]} {resLabel(t, r)}</button>)}
        </div>
        <button className="link" onClick={onClose}>{t('game.cancelEsc')}</button>
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
  const t = useT();
  const others = state.players.filter((p) => p.color !== proposer).map((p) => p.color);
  const [to, setTo] = useState<PlayerColor[]>(others);
  const cur = state.players.find((p) => p.color === proposer)!;
  const total = (m: Record<Resource, number>) => RESOURCES.reduce((s, r) => s + m[r], 0);
  const wantTotal = total(tradeWant) + (counter ? 0 : wantAny);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>{counter ? t('game.counter') : t('game.proposeTrade')}</h3>
        <div className="trade-grid">
          <div>
            <h4>{t('game.youGive')}</h4>
            {RESOURCES.map((r) => (
              <div key={r} className="trade-row">
                <span>{RESOURCE_ICON[r]} {resLabel(t, r)} <small className="have">({cur.hand[r]})</small></span>
                <Stepper value={tradeGive[r]} max={cur.hand[r]} onChange={(v) => setTradeGive({ ...tradeGive, [r]: v })} />
              </div>
            ))}
          </div>
          <div>
            <h4>{t('game.youWant')}</h4>
            {RESOURCES.map((r) => (
              <div key={r} className="trade-row">
                <span>{RESOURCE_ICON[r]} {resLabel(t, r)}</span>
                <Stepper value={tradeWant[r]} max={19} onChange={(v) => setTradeWant({ ...tradeWant, [r]: v })} />
              </div>
            ))}
            {!counter && (
              <div className="trade-row trade-any">
                <span title={t('game.wildcardTitle')}>{t('game.anyResource')}</span>
                <Stepper value={wantAny} max={9} onChange={setWantAny} />
              </div>
            )}
          </div>
        </div>
        {!counter && (
          <div className="trade-recipients">
            <span>{t('game.to')}</span>
            {others.map((c) => (
              <label key={c} className="chk">
                <input type="checkbox" checked={to.includes(c)}
                  onChange={(e) => setTo((cur2) => (e.target.checked ? [...cur2, c] : cur2.filter((x) => x !== c)))} />
                <span className="swatch" style={{ background: PLAYER_FILL[c] }} /> {colorLabel(t, c)}
              </label>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="primary" disabled={total(tradeGive) === 0 || wantTotal === 0 || (!counter && to.length === 0)}
            onClick={() => onPropose(to)}>{counter ? t('game.sendCounter') : t('game.propose')}</button>
          <button onClick={onClose}>{t('game.cancelEsc')}</button>
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
  const t = useT();
  const hand = getPlayer(state, color).hand;
  const [picks, setPicks] = useState<Record<Resource, number>>(zeroRes);
  const total = RESOURCES.reduce((s, r) => s + picks[r], 0);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('game.wildcardPick', { count })}</h3>
        <p className="muted-note">{t('game.selected', { total, count })}</p>
        <div className="trade-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div>
            {RESOURCES.map((r) => (
              <div key={r} className="trade-row">
                <span>{RESOURCE_ICON[r]} {resLabel(t, r)} ({hand[r]})</span>
                <Stepper value={picks[r]} max={Math.min(hand[r], picks[r] + Math.max(0, count - total))} onChange={(v) => setPicks((p) => ({ ...p, [r]: v }))} />
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="primary" disabled={total !== count} onClick={() => onConfirm(picks)}>{t('game.acceptTrade')}</button>
          <button onClick={onClose}>{t('game.cancelEsc')}</button>
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
  const t = useT();
  const tr = state.activeTrade!;
  const fmt = (m: Partial<Record<Resource, number>>) =>
    (Object.entries(m) as [Resource, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${n}${RESOURCE_ICON[r]}`).join(' ') || '—';
  const wantLabel = `${fmt(tr.want)}${tr.wantAny ? `${Object.values(tr.want).some((n) => n > 0) ? ' + ' : ''}${tr.wantAny}🃏` : ''}`;
  const iAmProposer = tr.from === localColor;
  const iAmRecipient = tr.to.includes(localColor);
  // Barra de tempo (20s): na oferta de um bot para mim, ou quando EU proponho.
  const showTimer = iAmProposer || (botOffer && iAmRecipient);
  return (
    <div className="trade-popup">
      <h3>{t('game.wantsToTrade', { name: colorLabel(t, tr.from) })}</h3>
      <p className="trade-summary">{t('game.tradeGiveArrow')} <b>{fmt(tr.give)}</b> &nbsp;→&nbsp; {t('game.tradeWantArrow')} <b>{wantLabel}</b></p>
      {showTimer && (
        // key muda a cada nova proposta -> a barra remonta e o tempo reinicia em sincronia.
        <div className="trade-timer">
          <span key={`${tr.from}:${JSON.stringify(tr.give)}:${JSON.stringify(tr.want)}`} className="trade-timer-bar" />
        </div>
      )}
      {iAmProposer ? (
        <>
          <div className="trade-responders">
            {tr.to.map((c) => {
              const accepted = tr.accepted.includes(c);
              return (
                <div key={c} className="trade-row">
                  <span><span className="swatch" style={{ background: PLAYER_FILL[c] }} /> {colorLabel(t, c)} {accepted ? '✅' : '⏳'}</span>
                  <button className="primary" disabled={!accepted} onClick={() => dispatch({ t: 'confirmTrade', with: c }, tr.from)}>{t('game.close')}</button>
                </div>
              );
            })}
          </div>
          <div className="modal-actions">
            <button onClick={() => dispatch({ t: 'cancelTrade' }, tr.from)}>{t('common.cancel')}</button>
          </div>
        </>
      ) : iAmRecipient ? (
        <div className="modal-actions wrap">
          <button onClick={onRefuse}>{t('game.refuse')}</button>
          <button onClick={onCounter}>{t('game.counterShort')}</button>
          <button className="primary"
            onClick={() => (tr.wantAny ? onWildcardAccept() : dispatch({ t: 'respondTrade', accept: true }, localColor))}>
            {t('game.accept')}
          </button>
        </div>
      ) : (
        <p className="muted-note">{t('game.awaitingResponse')}</p>
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
  const t = useT();
  return (
    <div className="overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('game.robWhom')}</h3>
        <div className="dev-cards">
          {victims.map((c) => (
            <button key={c} onClick={() => onPick(c)}>
              <span className="swatch" style={{ background: PLAYER_FILL[c] }} /> {t('game.victimCards', { name: colorLabel(t, c), n: handSize(getPlayer(state, c)) })}
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
  const t = useT();
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
        <h3>{t('game.discardTitle', { count, name: colorLabel(t, color) })}</h3>
        <p className="muted-note">{t('game.selectedF', { total, count })}</p>
        <div className="trade-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div>
            {RESOURCES.map((r) => (
              <div key={r} className="trade-row">
                <span>{RESOURCE_ICON[r]} {resLabel(t, r)} ({hand[r]})</span>
                {/* Não deixa passar do necessário: o + trava ao atingir `count`
                    (diminua um recurso para liberar outro). */}
                <Stepper value={picks[r]} max={Math.min(hand[r], picks[r] + Math.max(0, count - total))} onChange={(v) => setPicks((p) => ({ ...p, [r]: v }))} />
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="primary" disabled={total !== count} onClick={() => onDiscard(picks)}>{t('game.discard')}</button>
        </div>
      </div>
    </div>
  );
}

/** Ano da Fartura (+2 Recursos): mesmo formato do descarte (steppers), mas o
 *  jogador escolhe 2 recursos para PEGAR do banco (pode repetir o mesmo). */
function YearOfPlentyModal({
  state,
  onConfirm,
  onClose,
}: {
  state: GameState;
  onConfirm: (resources: [Resource, Resource]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const NEED = 2;
  const bank = state.bank;
  const [picks, setPicks] = useState<Record<Resource, number>>({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
  const total = RESOURCES.reduce((s, r) => s + picks[r], 0);
  function confirm() {
    const chosen: Resource[] = [];
    for (const r of RESOURCES) for (let i = 0; i < picks[r]; i++) chosen.push(r);
    if (chosen.length === NEED) onConfirm([chosen[0]!, chosen[1]!]);
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('game.yopTitle')}</h3>
        <p className="muted-note">{t('game.selected', { total, count: NEED })}</p>
        <div className="trade-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div>
            {RESOURCES.map((r) => (
              <div key={r} className="trade-row">
                <span>{RESOURCE_ICON[r]} {resLabel(t, r)} ({bank[r]})</span>
                {/* Trava ao atingir 2 (diminua um para liberar outro) e no que o
                    banco tem — o servidor recusa pegar recurso que o banco não tem. */}
                <Stepper value={picks[r]} max={Math.min(bank[r], picks[r] + Math.max(0, NEED - total))} onChange={(v) => setPicks((p) => ({ ...p, [r]: v }))} />
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="primary" disabled={total !== NEED} onClick={confirm}>{t('game.take')}</button>
          <button className="link" onClick={onClose}>{t('game.cancelEsc')}</button>
        </div>
      </div>
    </div>
  );
}


function getPlayer(state: GameState, color: PlayerColor) {
  return state.players.find((p) => p.color === color)!;
}

/** Placar final (pontos públicos, maior primeiro) — usado na tela de fim e na imagem. */
/** Placar final: no fim de jogo o estado é revelado, então usamos a pontuação
 *  REAL (scoreOf, com as cartas de Ponto de Vitória contadas). */
function standingsOf(state: GameState): { color: PlayerColor; name: string; pts: number }[] {
  return state.players
    .map((p) => ({ color: p.color, name: p.name, pts: scoreOf(state, p.color) }))
    .sort((a, b) => b.pts - a.pts);
}

/**
 * Tela de fim de jogo (não existia): pódio + placar + botão de COMPARTILHAR uma
 * imagem do resultado (Colonist v195 — marketing orgânico). Usa a Web Share API
 * quando disponível (celular), senão baixa o PNG.
 */
function EndGameOverlay({
  state, localColor, elapsed, turns, onExit, botColors, awayColors, viewerColor, onClose, onPlayer,
}: {
  state: GameState;
  localColor: PlayerColor;
  elapsed: number;
  turns: number;
  onExit: () => void;
  botColors: PlayerColor[];
  awayColors: PlayerColor[];
  viewerColor: PlayerColor | null;
  /** Fecha o placar para inspecionar o tabuleiro (só leitura). */
  onClose: () => void;
  onPlayer: (username: string, x: number, y: number) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const winner = state.winner!;
  const winnerName = getPlayer(state, winner).name;
  const iWon = winner === localColor;
  const standings = standingsOf(state);

  async function share() {
    setBusy(true);
    try {
      const blob = await renderResultBlob(state, elapsed, turns, t);
      if (!blob) return;
      const file = new File([blob], 'trevalis-resultado.png', { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> };
      const text = t('game.shareText', { name: winnerName });
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
    <div className="overlay endgame-overlay" onClick={onClose}>
      <div className="modal endgame-modal" onClick={(e) => e.stopPropagation()}>
        <button className="endgame-close" aria-label={t('game.closeResult')} title={t('game.viewBoard')} onClick={onClose}>
          <X size={18} />
        </button>
        <div className="endgame-crown" style={{ background: PLAYER_FILL[winner] }}><Trophy size={30} /></div>
        <h3 className="endgame-title">{iWon ? t('game.youWon') : t('game.playerWon', { name: winnerName })}</h3>
        <p className="muted-note endgame-sub">{t('game.endSub', { time: fmtTime(elapsed), turns })}</p>
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
                  <span className="endgame-nm">{s.name}{s.color === localColor && <small className="you-tag"> {t('game.you')}</small>}</span>
                )}
                <b className="endgame-pts">{s.pts} pts</b>
              </div>
            );
          })}
        </div>
        <div className="modal-actions endgame-actions">
          <button className="primary" onClick={share} disabled={busy}>
            {navigatorCanShare() ? <Share2 size={15} /> : <Download size={15} />} {busy ? t('game.generating') : t('game.shareResult')}
          </button>
          <button className="ghost" onClick={onClose}><Hexagon size={15} /> {t('game.viewBoard')}</button>
          <button onClick={onExit}><LogOut size={15} /> {t('game.exit')}</button>
        </div>
      </div>
    </div>
  );
}

function navigatorCanShare(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as { share?: unknown }).share === 'function';
}

/** Desenha um cartão de resultado (1200×630, formato de social card) e devolve um PNG. */
function renderResultBlob(state: GameState, elapsed: number, turns: number, t: TFn): Promise<Blob | null> {
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
  ctx.fillText(t('game.head.won', { name: winnerName }), 60, 150);

  ctx.fillStyle = '#8a7a64';
  ctx.font = '400 26px Georgia, serif';
  ctx.fillText(t('game.endImgSub', { time: fmtTime(elapsed), turns }), 60, 196);

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
  ctx.fillText(t('game.playAt'), 60, H - 46);

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
function headline(state: GameState, myTurn: boolean, botTurn: boolean, curName: string, t: TFn): string {
  if (state.phase === 'ended') return t('game.head.won', { name: colorLabel(t, state.winner!) });
  if (state.phase === 'discard') return t('game.head.discard');
  if (botTurn) return t('game.head.botPlaying', { name: curName });
  if (!myTurn) return t('game.head.waiting');
  if (state.phase === 'moveBlocker') return t('game.head.moveRobber');
  if (state.phase === 'setup1' || state.phase === 'setup2') {
    return state.setupLastVertex ? t('game.head.placeRoad') : t('game.head.placeSettlement');
  }
  if (state.phase === 'roll') return t('game.head.roll');
  if (state.phase === 'main') return t('game.head.main');
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

function toastForEvent(e: GameEvent, state: GameState, t: TFn): { text: string; tone: ToastTone } | null {
  switch (e.t) {
    case 'produced': {
      const g = e.gains[state.currentPlayer];
      const items = (Object.entries(g) as [Resource, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${n}${RESOURCE_ICON[r]}`);
      return items.length ? { text: t('game.toast.received', { items: items.join(' ') }), tone: 'good' } : null;
    }
    case 'cardPlayed':
      return { text: t('game.toast.played', { name: colorLabel(t, e.owner), card: cardLabel(t, e.card) }), tone: 'info' };
    case 'monopoly':
      return { text: t('game.toast.monopoly', { name: colorLabel(t, e.owner), resource: resLabel(t, e.resource), n: e.taken }), tone: 'warn' };
    case 'blockerMoved':
      return e.stoleFrom ? { text: t('game.toast.robberSteal', { name: colorLabel(t, e.stoleFrom) }), tone: 'warn' } : null;
    case 'tradeExecuted':
      return { text: t('game.toast.tradeExecuted', { a: colorLabel(t, e.from), b: colorLabel(t, e.with) }), tone: 'good' };
    case 'longestRoad':
      return e.owner ? { text: t('game.toast.longestRoad', { name: colorLabel(t, e.owner) }), tone: 'good' } : null;
    case 'largestArmy':
      return e.owner ? { text: t('game.toast.largestArmy', { name: colorLabel(t, e.owner) }), tone: 'good' } : null;
    case 'turnEnded':
      return { text: t('game.toast.turnOf', { name: colorLabel(t, e.next) }), tone: 'info' };
    case 'gameWon':
      return { text: t('game.toast.gameWon', { name: colorLabel(t, e.winner) }), tone: 'good' };
    default:
      return null;
  }
}

/** Nome do jogador (cai no rotulo da cor se nao achar). */
function nm(state: GameState, color: PlayerColor, t: TFn): string {
  return state.players.find((p) => p.color === color)?.name ?? colorLabel(t, color);
}

function describeEvent(e: GameEvent, state: GameState, t: TFn): string {
  switch (e.t) {
    case 'diceRolled':
      return t('game.log.dice', { a: e.dice[0], b: e.dice[1], sum: e.sum });
    case 'produced': {
      const parts: string[] = [];
      for (const p of state.players) {
        const g = e.gains[p.color];
        const items = (Object.entries(g) as [Resource, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${n}${RESOURCE_ICON[r]}`);
        if (items.length) parts.push(`${p.name}: ${items.join(' ')}`);
      }
      return parts.length ? t('game.log.production', { parts: parts.join(' · ') }) : t('game.log.productionNothing');
    }
    case 'built':
      return t('game.log.built', { name: nm(state, e.owner, t), what: t(`build.${e.kind}` as MsgKey) });
    case 'progressCardBought':
      return t('game.log.boughtCard', { name: nm(state, e.owner, t) });
    case 'cardPlayed':
      return t('game.log.playedCard', { name: nm(state, e.owner, t), card: cardLabel(t, e.card) });
    case 'monopoly':
      return t('game.log.monopoly', { name: nm(state, e.owner, t), resource: resLabel(t, e.resource), n: e.taken });
    case 'blockerMoved':
      return e.stoleFrom ? t('game.log.robberSteal', { name: nm(state, e.stoleFrom, t) }) : t('game.log.robberMoved');
    case 'mustDiscard':
      return t('game.log.mustDiscard', { names: e.players.map((p) => nm(state, p.color, t)).join(', ') });
    case 'discarded':
      return t('game.log.discarded', { name: nm(state, e.owner, t) });
    case 'bankTrade':
      return t('game.log.bankTrade', { name: nm(state, e.owner, t), rate: e.rate, give: resLabel(t, e.give), want: resLabel(t, e.want) });
    case 'tradeProposed':
      return t('game.log.tradeProposed', { name: nm(state, e.from, t) });
    case 'tradeCountered':
      return t('game.log.tradeCountered', { name: nm(state, e.from, t) });
    case 'tradeResponded':
      return e.accept
        ? t('game.log.tradeAccepted', { name: nm(state, e.player, t) })
        : t('game.log.tradeRefused', { name: nm(state, e.player, t) });
    case 'tradeExecuted':
      return t('game.log.tradeExecuted', { a: nm(state, e.from, t), b: nm(state, e.with, t) });
    case 'tradeCancelled':
      return t('game.log.tradeCancelled');
    case 'longestRoad':
      return e.owner ? t('game.log.longestRoad', { name: nm(state, e.owner, t) }) : t('game.log.longestRoadLost');
    case 'largestArmy':
      return e.owner ? t('game.log.largestArmy', { name: nm(state, e.owner, t) }) : t('game.log.largestArmyLost');
    case 'turnEnded':
      return t('game.log.turnEnded', { name: nm(state, e.next, t) });
    case 'gameWon':
      return t('game.log.gameWon', { name: nm(state, e.winner, t) });
    default:
      return '';
  }
}
