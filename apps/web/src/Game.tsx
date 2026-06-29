import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createInitialState,
  reduce,
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
  Volume2, VolumeX, HelpCircle, LogOut,
} from 'lucide-react';
import { planBotAction, resolveBotProposal, suggestSetupSettlement } from '@trevalis/bot';
import { Board, type InteractionMode } from './board/Board.js';
import { Dice } from './ui/Dice.js';
import { HandBar } from './ui/HandBar.js';
import { useFlyer, FlyLayer, type Pt } from './ui/FlyLayer.js';
import { RES_IMG, DEV_IMG } from './game/cards.js';
import { Toasts, useToasts, type ToastTone } from './ui/Toasts.js';
import { play as playSound, setMuted, unlockAudio, type SoundKind } from './ui/sound.js';
import { saveReplay } from './ui/replays.js';
import type { GameConfig } from './ui/Lobby.js';
import { PLAYER_FILL, PLAYER_LABEL, RESOURCE_ICON, RESOURCE_LABEL } from './game/theme.js';

/** Limites de tempo (s) por acao, por ritmo — espelham o servidor (PACE_TIMERS). */
const PACE_TIMERS = {
  fast: { settlement: 120, road: 30, dice: 10, robber: 20, discard: 20, turn: 60 },
  normal: { settlement: 180, road: 45, dice: 20, robber: 40, discard: 40, turn: 120 },
} as const;

function fmtSecs(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

/** Descarte aleatorio de n cartas da mao (default por tempo). */
function randomDiscard(s: GameState, me: PlayerColor): Partial<Record<Resource, number>> {
  const p = s.players.find((pl) => pl.color === me)!;
  const n = s.pendingDiscards[me] ?? 0;
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
function desertHex(s: GameState): string {
  const cur = s.blocker.hexId;
  const desert = s.board.hexOrder.find((h) => h !== cur && s.board.hexes[h]!.terrain === 'desert');
  if (desert) return desert;
  const empty = s.board.hexOrder.find(
    (h) => h !== cur && s.board.hexes[h]!.corners.every((v) => !s.buildings[v]),
  );
  return empty ?? s.board.hexOrder.find((h) => h !== cur)!;
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

export function Game({ config, onExit }: { config: GameConfig; onExit: () => void }) {
  const [state, setState] = useState<GameState>(() =>
    createInitialState({
      seed: config.seed,
      boardLayout: config.boardLayout,
      players: config.players,
      numberLayout: config.numberLayout,
      desert: config.desert,
      pointsToWin: config.pointsToWin,
      discardLimit: config.discardLimit,
      friendlyRobber: config.friendlyRobber,
    }),
  );
  const [log, setLog] = useState<LogEntry[]>([{ kind: 'event', text: 'Partida iniciada. Coloquem as vilas iniciais.' }]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<InteractionMode>('idle');
  const [give, setGive] = useState<Resource>('wood');
  const [want, setWant] = useState<Resource>('brick');
  const [arming, setArming] = useState<'yearOfPlenty' | 'monopoly' | 'trade' | 'counter' | null>(null);
  const [yopPicks, setYopPicks] = useState<Resource[]>([]);
  const [tradeGive, setTradeGive] = useState<Record<Resource, number>>(zeroRes);
  const [tradeWant, setTradeWant] = useState<Record<Resource, number>>(zeroRes);
  const [help, setHelp] = useState(false);
  // Quando o ladrao pode roubar de 2+ jogadores, o humano escolhe a vitima.
  const [robberChoice, setRobberChoice] = useState<{ hexId: string; victims: PlayerColor[] } | null>(null);
  // Confirmacao antes de construir.
  const [muted, setMutedState] = useState(false);
  const [elapsed, setElapsed] = useState(0); // cronometro da partida (segundos)
  const [turnCount, setTurnCount] = useState(1); // contador de turno
  const [chatInput, setChatInput] = useState('');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  // Historico de acoes da partida (para replay + treino da IA).
  const historyRef = useRef<{ by: PlayerColor; action: Action }[]>([]);
  const { toasts, push } = useToasts();
  const { items: flyItems, fly } = useFlyer();

  // Cronometro: conta enquanto a partida nao terminou.
  useEffect(() => {
    if (state.phase === 'ended') return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state.phase]);

  function sendChat() {
    const t = chatInput.trim();
    if (!t) return;
    setChat((prev) => [...prev, { color: localColor, name: localPlayer.name, text: t }].slice(-200));
    setChatInput('');
  }

  const isBot = useMemo(() => {
    const set = new Set(config.bots);
    return (c: PlayerColor) => set.has(c);
  }, [config.bots]);
  const difficultyOf = useMemo(() => {
    const map = config.botDifficulty ?? {};
    return (c: PlayerColor) => map[c] ?? 'medium';
  }, [config.botDifficulty]);
  const botTurn = isBot(state.currentPlayer);

  // "Eu" (jogador local): com 1 humano, e sempre ele; em hotseat com varios
  // humanos, e o humano da vez. As maos dos demais ficam ocultas (so contagem).
  const humanColors = state.players.filter((p) => !isBot(p.color)).map((p) => p.color);
  const localColor: PlayerColor =
    humanColors.length === 1
      ? humanColors[0]!
      : !isBot(state.currentPlayer)
        ? state.currentPlayer
        : (humanColors[0] ?? state.currentPlayer);
  const localPlayer = getPlayer(state, localColor);
  const myTurn = state.currentPlayer === localColor;

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
  }

  function dispatch(action: Action, by: PlayerColor = state.currentPlayer) {
    const prevBlocker = state.blocker.hexId;
    const res = reduce(state, by, action);
    if (!res.ok) {
      setError(res.error);
      push(res.error, 'warn');
      return false;
    }
    setError(null);
    setState(res.state);
    historyRef.current.push({ by, action });
    if (res.events.some((e) => e.t === 'gameWon')) {
      saveReplay({
        id: `${config.seed}-${Date.now()}`,
        date: Date.now(),
        seed: config.seed,
        players: config.players,
        humans: config.players.map((p) => p.color).filter((c) => !isBot(c)),
        winner: res.state.winner,
        pointsToWin: config.pointsToWin,
        discardLimit: config.discardLimit,
        boardLayout: config.boardLayout,
        friendlyRobber: config.friendlyRobber,
        numberLayout: config.numberLayout,
        desert: config.desert,
        turns: turnCount,
        durationSec: elapsed,
        actions: historyRef.current,
      });
    }
    const lines: LogEntry[] = res.events
      .map((e) => describeEvent(e, res.state))
      .filter(Boolean)
      .map((text) => ({ kind: 'event' as const, text }));
    const sep: LogEntry[] = res.events.some((e) => e.t === 'turnEnded') ? [{ kind: 'sep' as const }] : [];
    setLog((prev) => [...lines, ...sep, ...prev].slice(0, 200));
    for (const e of res.events) {
      const t = toastForEvent(e, res.state);
      if (t) push(t.text, t.tone);
      const s = soundForEvent(e);
      if (s) playSound(s);
    }
    if (res.events.some((e) => e.t === 'turnEnded' || e.t === 'gameWon')) setMode('idle');
    if (res.events.some((e) => e.t === 'turnEnded')) setTurnCount((n) => n + 1);
    scheduleAnimations(res.events, res.state, action, by, prevBlocker);
    resetTransient();
    return true;
  }

  /** Anima cartas/peças voando após uma jogada (espera o DOM atualizar). */
  function scheduleAnimations(
    events: GameEvent[],
    newState: GameState,
    action: Action,
    by: PlayerColor,
    prevBlocker: string,
  ) {
    const rolled = events.find((e) => e.t === 'diceRolled');
    const producedSum = rolled && events.some((e) => e.t === 'produced') ? rolled.sum : null;
    const moved = events.find((e) => e.t === 'blockerMoved');
    const spend = spentResources(action, events);
    if (producedSum === null && !moved && !spend) return;

    raf2(() => {
      const svg = document.querySelector<SVGSVGElement>('.board-wrap > svg');
      // Ganho de recurso: hexágono -> mão (meu) ou avatar do dono.
      if (producedSum !== null && svg) {
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
      // Ladrão: movimento do hex antigo para o novo.
      if (moved && svg && prevBlocker !== moved.hexId) {
        const a = newState.board.hexes[prevBlocker];
        const b = newState.board.hexes[moved.hexId];
        // O ladrao e desenhado em (cx, cy-26); a animacao mira essa posicao, nao o centro do hex.
        if (a && b) fly({ kind: 'robber', from: svgScreen(svg, a.cx, a.cy - 26), to: svgScreen(svg, b.cx, b.cy - 26), duration: 650 });
      }
      // Roubo pelo ladrão: carta da vítima -> ladrão (após o ladrão pousar).
      if (moved && moved.stoleFrom && moved.resource) {
        const from = destForOwner(moved.stoleFrom, localColor);
        const to = destForOwner(by, localColor);
        if (from && to) fly({ kind: 'card', img: RES_IMG[moved.resource], from, to, delay: 380, duration: 560 });
      }
      // Gasto/descarte: mão (ou avatar) -> Banco.
      if (spend) {
        const from = destForOwner(by, localColor);
        const to = anchorCenter('[data-anchor="bank"]');
        if (from && to) {
          let delay = 0;
          for (const r of RESOURCES) {
            for (let k = 0; k < (spend[r] ?? 0); k++) {
              fly({ kind: 'card', img: RES_IMG[r], from, to, delay });
              delay += 70;
            }
          }
        }
      }
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

  // Auto-jogo dos bots: ao menos 1s entre acoes para o humano acompanhar.
  useEffect(() => {
    const move = planBotAction(state, isBot, difficultyOf);
    if (!move) return;
    const delay = state.phase === 'setup1' || state.phase === 'setup2' ? 1000 : 1100;
    const id = setTimeout(() => dispatch(move.action, move.by), delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isBot, difficultyOf]);

  // Resolucao automatica de trocas (janela de 20s). Vale quando o proponente e o
  // jogador local (humano propos/contrapropos) ou quando um bot propos na sua vez.
  useEffect(() => {
    const t = state.activeTrade;
    if (!t) return;
    let wait: number;
    if (t.from === localColor) wait = 20000; // eu propus: janela de 20s (ou Fecho antes)
    else if (isBot(t.from) && isBot(state.currentPlayer)) wait = t.accepted.length > 0 ? 1500 : 20000; // bot propos
    else return;
    const id = setTimeout(() => {
      const mv = resolveBotProposal(state);
      if (mv) dispatch(mv.action, mv.by);
    }, wait);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isBot, localColor]);

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

  // Mapa nome -> cor para pintar os nomes no Pergaminho.
  const logNames = useMemo<NameColor[]>(
    () => config.players.map((p) => ({ name: p.name, color: PLAYER_FILL[p.color] })),
    [config.players],
  );

  // ---- Limite de tempo por acao (ritmo Rapido/Normal) ----
  const pace = config.pace ?? 'normal';
  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  /** Acao default quando o tempo de `me` estoura (mesmas regras do servidor). */
  function computeTimeoutAction(s: GameState, me: PlayerColor): { action: Action; by: PlayerColor } | null {
    if (s.activeTrade) return { action: { t: 'cancelTrade' }, by: s.activeTrade.from };
    if (s.phase === 'discard' && (s.pendingDiscards[me] ?? 0) > 0)
      return { action: { t: 'discard', resources: randomDiscard(s, me) }, by: me };
    if (s.currentPlayer !== me) return null;
    if (s.phase === 'moveBlocker') return { action: { t: 'moveBlocker', hexId: desertHex(s) }, by: me };
    if (s.phase === 'roll') return { action: { t: 'rollDice' }, by: me }; // sem cavaleiro
    if (s.phase === 'setup1' || s.phase === 'setup2') {
      const mv = planBotAction(s, (c) => c === me || isBot(c), difficultyOf); // um bot coloca
      return mv ? { action: mv.action, by: mv.by } : null;
    }
    if (s.phase === 'main') return { action: { t: 'endTurn' }, by: me };
    return null;
  }

  // Situacao atual que tem prazo para o JOGADOR LOCAL (ou null). A troca tem seu
  // proprio relogio (popup), entao fica de fora daqui.
  const turnTimer = useMemo((): { secs: number; key: string } | null => {
    if (state.activeTrade || state.winner) return null;
    const me = localColor;
    const tt = PACE_TIMERS[pace];
    if (state.phase === 'discard' && (state.pendingDiscards[me] ?? 0) > 0)
      return { secs: tt.discard, key: `discard:${state.pendingDiscards[me]}` };
    if (state.currentPlayer !== me) return null;
    if (state.phase === 'setup1' || state.phase === 'setup2')
      return { secs: state.setupLastVertex ? tt.road : tt.settlement, key: `setup:${state.setupStep}:${state.setupLastVertex ?? '-'}` };
    if (state.phase === 'roll') return { secs: tt.dice, key: `roll:${turnCount}` };
    if (state.phase === 'moveBlocker') return { secs: tt.robber, key: `robber:${state.blocker.hexId}` };
    if (state.phase === 'main') return { secs: tt.turn, key: `main:${turnCount}` };
    return null;
  }, [state, localColor, pace, turnCount]);

  const [secsLeft, setSecsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!turnTimer) {
      setSecsLeft(null);
      return;
    }
    setSecsLeft(turnTimer.secs);
    const deadline = Date.now() + turnTimer.secs * 1000;
    const iv = setInterval(() => setSecsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    const to = setTimeout(() => {
      const mv = computeTimeoutAction(stateRef.current, localColor);
      if (mv) dispatchRef.current(mv.action, mv.by);
    }, turnTimer.secs * 1000);
    return () => {
      clearInterval(iv);
      clearTimeout(to);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnTimer?.key]);

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
                    <span className="noble-nick">{p.name}</span>
                    {p.color === localColor && <span className="you-tag">você</span>}
                    {isBot(p.color) && <span className="bot-tag">bot</span>}
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
            {state.activeTrade && (
              <ActiveTradePopup state={state} dispatch={dispatch} localColor={localColor}
                botOffer={isBot(state.activeTrade.from)} onCounter={() => openCounter(state.activeTrade!)} />
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
                  enabled={myMain && canAffordUI(localPlayer.hand, COSTS.progressCard) && state.devDeck.length > 0}
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
              {[...chat].reverse().map((m, i) => (
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
                <span className="card-count">{state.devDeck.length}</span>
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
          counter={arming === 'counter'}
          setTradeGive={setTradeGive} setTradeWant={setTradeWant}
          onPropose={(to) =>
            arming === 'counter'
              ? dispatch({ t: 'counterTrade', give: tradeGive, want: tradeWant }, localColor)
              : dispatch({ t: 'proposeTrade', give: tradeGive, want: tradeWant, to })
          }
          onClose={resetTransient} />
      )}
      {robberChoice && (
        <RobberVictimModal
          state={state}
          victims={robberChoice.victims}
          onPick={(victim) => { dispatch({ t: 'moveBlocker', hexId: robberChoice.hexId, stealFrom: victim }); setRobberChoice(null); }}
        />
      )}
      {(() => {
        if (state.phase !== 'discard') return null;
        const who = (Object.keys(state.pendingDiscards) as PlayerColor[]).find((c) => !isBot(c));
        if (!who) return null;
        return (
          <DiscardModal
            state={state}
            color={who}
            count={state.pendingDiscards[who]!}
            onDiscard={(resources) => dispatch({ t: 'discard', resources }, who)}
          />
        );
      })()}
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
        <p className="muted-note">Passe o mouse para ver alvos válidos · clique para colocar · ESC cancela.</p>
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
  state, proposer, counter, tradeGive, tradeWant, setTradeGive, setTradeWant, onPropose, onClose,
}: {
  state: GameState;
  proposer: PlayerColor;
  counter?: boolean;
  tradeGive: Record<Resource, number>;
  tradeWant: Record<Resource, number>;
  setTradeGive: (v: Record<Resource, number>) => void;
  setTradeWant: (v: Record<Resource, number>) => void;
  onPropose: (to: PlayerColor[]) => void;
  onClose: () => void;
}) {
  const others = state.players.filter((p) => p.color !== proposer).map((p) => p.color);
  const [to, setTo] = useState<PlayerColor[]>(others);
  const cur = state.players.find((p) => p.color === proposer)!;
  const total = (m: Record<Resource, number>) => RESOURCES.reduce((s, r) => s + m[r], 0);
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
          <button className="primary" disabled={total(tradeGive) === 0 || total(tradeWant) === 0 || (!counter && to.length === 0)}
            onClick={() => onPropose(to)}>{counter ? 'Enviar contraproposta' : 'Propor'}</button>
          <button onClick={onClose}>Cancelar (ESC)</button>
        </div>
      </div>
    </div>
  );
}

/** Painel de troca no canto do mapa (sem escurecer a tela). */
function ActiveTradePopup({
  state,
  dispatch,
  localColor,
  botOffer,
  onCounter,
}: {
  state: GameState;
  dispatch: (a: Action, by?: PlayerColor) => boolean;
  localColor: PlayerColor;
  botOffer: boolean;
  onCounter: () => void;
}) {
  const t = state.activeTrade!;
  const fmt = (m: Partial<Record<Resource, number>>) =>
    (Object.entries(m) as [Resource, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${n}${RESOURCE_ICON[r]}`).join(' ') || '—';
  const iAmProposer = t.from === localColor;
  const iAmRecipient = t.to.includes(localColor);
  // Barra de tempo (20s): na oferta de um bot para mim, ou quando EU proponho.
  const showTimer = iAmProposer || (botOffer && iAmRecipient);
  return (
    <div className="trade-popup">
      <h3>{PLAYER_LABEL[t.from]} quer trocar</h3>
      <p className="trade-summary">Dá <b>{fmt(t.give)}</b> &nbsp;→&nbsp; quer <b>{fmt(t.want)}</b></p>
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
          <button onClick={() => dispatch({ t: 'cancelTrade' }, t.from)}>✗ Recusar</button>
          <button onClick={onCounter}>✎ Contraproposta</button>
          <button className="primary" onClick={() => dispatch({ t: 'respondTrade', accept: true }, localColor)}>✓ Aceitar</button>
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
}: {
  state: GameState;
  color: PlayerColor;
  count: number;
  onDiscard: (resources: Partial<Record<Resource, number>>) => void;
}) {
  const hand = getPlayer(state, color).hand;
  const [picks, setPicks] = useState<Record<Resource, number>>({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
  const total = RESOURCES.reduce((s, r) => s + picks[r], 0);
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
                <Stepper value={picks[r]} max={hand[r]} onChange={(v) => setPicks((p) => ({ ...p, [r]: v }))} />
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

/** Recursos gastos por uma ação (para a animação mão -> banco). */
function spentResources(action: Action, events: GameEvent[]): Partial<Record<Resource, number>> | null {
  switch (action.t) {
    case 'buildRoad':
      return COSTS.road;
    case 'buildSettlement':
      return COSTS.settlement;
    case 'buildCity':
      return COSTS.city;
    case 'buyProgressCard':
      return COSTS.progressCard;
    case 'discard':
      return action.resources;
    case 'tradeBank': {
      const e = events.find((x) => x.t === 'bankTrade');
      return e && e.t === 'bankTrade' ? ({ [action.give]: e.rate } as Partial<Record<Resource, number>>) : null;
    }
    default:
      return null;
  }
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
