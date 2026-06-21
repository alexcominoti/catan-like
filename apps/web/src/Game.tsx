import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createInitialState,
  reduce,
  publicScoreOf,
  handTotal,
  longestRoadLength,
  maritimeRate,
  COSTS,
  RESOURCES,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerColor,
  type ProgressCard,
  type Resource,
} from '@hexgame/engine';
import { planBotAction, resolveBotProposal } from '@hexgame/bot';
import { Board, type InteractionMode } from './board/Board.js';
import { Dice } from './ui/Dice.js';
import { HandBar } from './ui/HandBar.js';
import { Toasts, useToasts, type ToastTone } from './ui/Toasts.js';
import { play as playSound, setMuted, unlockAudio, type SoundKind } from './ui/sound.js';
import type { GameConfig } from './ui/Lobby.js';
import { PLAYER_FILL, PLAYER_LABEL, RESOURCE_ICON, RESOURCE_LABEL } from './game/theme.js';

interface PendingBuild {
  action: Action;
  label: string;
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

export function Game({ config, onExit }: { config: GameConfig; onExit: () => void }) {
  const [state, setState] = useState<GameState>(() =>
    createInitialState({
      seed: config.seed,
      players: config.players,
      numberLayout: config.numberLayout,
      desert: config.desert,
      pointsToWin: config.pointsToWin,
      discardLimit: config.discardLimit,
    }),
  );
  const [log, setLog] = useState<string[]>(['Partida iniciada. Coloquem as vilas iniciais.']);
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
  const [pendingBuild, setPendingBuild] = useState<PendingBuild | null>(null);
  const [muted, setMutedState] = useState(false);
  const { toasts, push } = useToasts();

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
    if (state.phase === 'main') return mode;
    return 'idle';
  }, [state.phase, state.setupLastVertex, state.currentPlayer, mode, isBot]);

  function resetTransient() {
    setArming(null);
    setYopPicks([]);
    setTradeGive(zeroRes());
    setTradeWant(zeroRes());
  }

  function dispatch(action: Action, by: PlayerColor = state.currentPlayer) {
    const res = reduce(state, by, action);
    if (!res.ok) {
      setError(res.error);
      push(res.error, 'warn');
      return false;
    }
    setError(null);
    setState(res.state);
    const lines = res.events.map((e) => describeEvent(e, res.state)).filter(Boolean);
    setLog((prev) => [...lines, ...prev].slice(0, 200));
    for (const e of res.events) {
      const t = toastForEvent(e, res.state);
      if (t) push(t.text, t.tone);
      const s = soundForEvent(e);
      if (s) playSound(s);
    }
    if (res.events.some((e) => e.t === 'turnEnded' || e.t === 'gameWon')) setMode('idle');
    resetTransient();
    return true;
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMode('idle');
        setArming(null);
        setYopPicks([]);
        setHelp(false);
        setPendingBuild(null);
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

  // Durante a vez de um BOT com uma troca ativa (oferta do bot OU contraproposta
  // de humano), da uma janela e entao resolve (fecha com quem aceitou, ou cancela).
  useEffect(() => {
    const t = state.activeTrade;
    if (!t || !isBot(state.currentPlayer)) return;
    let wait: number;
    if (t.from === state.currentPlayer) wait = t.accepted.length > 0 ? 1200 : 10000; // oferta do bot: 10s
    else wait = t.accepted.length > 0 ? 1000 : 4000; // contraproposta do humano
    const id = setTimeout(() => {
      const mv = resolveBotProposal(state);
      if (mv) dispatch(mv.action, mv.by);
    }, wait);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isBot]);

  // Toca um som quando vira a minha vez (entrada na fase de rolar).
  const wasMyRoll = useRef(false);
  useEffect(() => {
    const isMyRoll = myTurn && state.phase === 'roll';
    if (isMyRoll && !wasMyRoll.current) playSound('yourTurn');
    wasMyRoll.current = isMyRoll;
  }, [myTurn, state.phase]);

  function onVertex(vid: string) {
    if (effMode === 'placeSettlement') setPendingBuild({ action: { t: 'placeSettlement', vertexId: vid }, label: 'Colocar vila aqui?' });
    else if (effMode === 'buildSettlement') setPendingBuild({ action: { t: 'buildSettlement', vertexId: vid }, label: 'Construir vila aqui?' });
    else if (effMode === 'buildCity') setPendingBuild({ action: { t: 'buildCity', vertexId: vid }, label: 'Construir cidade aqui?' });
  }
  function onEdge(eid: string) {
    if (effMode === 'placeRoad') setPendingBuild({ action: { t: 'placeRoad', edgeId: eid }, label: 'Colocar estrada aqui?' });
    else if (effMode === 'buildRoad') setPendingBuild({ action: { t: 'buildRoad', edgeId: eid }, label: 'Construir estrada aqui?' });
  }
  function onHex(hid: string) {
    if (effMode !== 'moveBlocker') return;
    const hex = state.board.hexes[hid]!;
    const me = state.currentPlayer;
    const victims = [...new Set(
      hex.corners
        .map((vid) => state.buildings[vid]?.owner)
        .filter((o): o is PlayerColor => !!o && o !== me && handTotal(getPlayer(state, o)) > 0),
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

  return (
    <div className="app" style={{ ['--turn-color' as string]: playerColor }}>
      <header className="header">
        <h1>⬡ HexGame</h1>
        <div className="phase">
          {phaseLabel(state)} · Vez de{' '}
          <strong style={{ color: playerColor }}>{PLAYER_LABEL[state.currentPlayer]}</strong>
          {state.pendingFreeRoads > 0 && <span className="badge"> {state.pendingFreeRoads} estrada(s) grátis</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button title={muted ? 'Som desligado' : 'Som ligado'} onClick={() => { const m = !muted; setMutedState(m); setMuted(m); }}>
            {muted ? '🔇' : '🔊'}
          </button>
          <button onClick={() => setHelp(true)}>❔ Ajuda</button>
          <button onClick={onExit}>Novo jogo</button>
        </div>
      </header>

      <div className="board-wrap" style={{ borderColor: playerColor }}>
        <Board state={state} mode={effMode} onVertex={onVertex} onEdge={onEdge} onHex={onHex} />
        {state.activeTrade && (
          <ActiveTradePopup
            state={state}
            dispatch={dispatch}
            localColor={localColor}
            botOffer={isBot(state.activeTrade.from)}
            onCounter={() => openCounter(state.activeTrade!)}
          />
        )}
      </div>

      <aside className="sidebar">
        <div className="card">
          <h2>Jogadores</h2>
          {state.players.map((p) => (
            <div
              key={p.color}
              className={`player-card${p.color === state.currentPlayer ? ' active' : ''}`}
              style={{ ['--pc' as string]: PLAYER_FILL[p.color] }}
            >
              <div className="player-card-top">
                <span className="pc-color" style={{ background: PLAYER_FILL[p.color] }} />
                <span className="name">{p.name}{isBot(p.color) && <span title="Bot"> 🤖</span>}</span>
                <span className="vp-badge">{publicScoreOf(state, p.color)}<i>⭐</i></span>
              </div>
              <div className="player-stats">
                <span className="stat" title="Cartas na mão"><b>{handTotal(p)}</b><i>🂠</i></span>
                <span className="stat" title="Cartas de progresso"><b>{p.progressCards.length}</b><i>🃏</i></span>
                <span className={`stat${state.largestArmy.owner === p.color ? ' on' : ''}`} title="Cavaleiros jogados"><b>{p.knightsPlayed}</b><i>⚔️</i></span>
                <span className={`stat${state.longestRoad.owner === p.color ? ' on' : ''}`} title="Maior estrada"><b>{longestRoadLength(state, p.color)}</b><i>📏</i></span>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Banco</h2>
          <div className="hand">
            {RESOURCES.map((r) => (
              <span key={r} className="res-chip">{RESOURCE_ICON[r]} {state.bank[r]}</span>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Histórico</h2>
          <div className="log">{log.map((line, i) => <div key={i}>{line}</div>)}</div>
        </div>
      </aside>

      <HandBar hand={localPlayer.hand} devCards={localPlayer.progressCards} name={localPlayer.name} canPlay={canPlay} onPlay={playCard} />

      <div className="actionbar">
        <div className="action-status">{statusText(state, myTurn, botTurn, cur.name)}{error && <span className="error"> · ⚠ {error}</span>}</div>
        <div className="action-buttons">
          <button className={`primary${myRoll ? ' pulse' : ''}`} disabled={!myRoll} onClick={() => dispatch({ t: 'rollDice' })}>🎲 Rolar</button>
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
              {RESOURCES.map((r) => (
                <option key={r} value={r}>{RESOURCE_ICON[r]}×{maritimeRate(state, localColor, r)}</option>
              ))}
            </select>
            →
            <select value={want} onChange={(e) => setWant(e.target.value as Resource)} disabled={!myMain}>
              {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_ICON[r]}</option>)}
            </select>
            <button disabled={!myMain || localPlayer.hand[give] < bestRate} onClick={() => dispatch({ t: 'tradeBank', give, want })}>{bestRate}:1</button>
          </span>
          <button disabled={!myMain} onClick={() => setArming('trade')}>🤝 Propor troca</button>
          <button disabled={!myMain} onClick={() => dispatch({ t: 'endTurn' })}>Fim de turno</button>
          <Dice dice={state.dice} />
        </div>
      </div>

      <Toasts toasts={toasts} />

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
      {pendingBuild && (
        <div className="overlay" onClick={() => setPendingBuild(null)}>
          <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
            <h3>{pendingBuild.label}</h3>
            <div className="modal-actions">
              <button onClick={() => setPendingBuild(null)}>✗ Cancelar</button>
              <button className="primary" onClick={() => { dispatch(pendingBuild.action); setPendingBuild(null); }}>✓ Confirmar</button>
            </div>
          </div>
        </div>
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
                <span>{RESOURCE_ICON[r]} {RESOURCE_LABEL[r]}</span>
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
          <button className="primary" disabled={(total(tradeGive) === 0 && total(tradeWant) === 0) || (!counter && to.length === 0)}
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
  // Barra de tempo só na oferta de um bot para mim (janela de 10s).
  const showTimer = botOffer && iAmRecipient;
  return (
    <div className="trade-popup">
      <h3>{PLAYER_LABEL[t.from]} quer trocar</h3>
      <p className="trade-summary">Dá <b>{fmt(t.give)}</b> &nbsp;→&nbsp; quer <b>{fmt(t.want)}</b></p>
      {showTimer && (
        <div className="trade-timer"><span className="trade-timer-bar" /></div>
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

function statusText(state: GameState, myTurn: boolean, botTurn: boolean, curName: string): string {
  if (state.phase === 'ended') return `🏆 ${PLAYER_LABEL[state.winner!]} venceu! Clique em “Novo jogo”.`;
  if (state.phase === 'discard') return `Rolou 7! Quem tem mais de ${state.discardLimit} cartas descarta metade.`;
  if (botTurn) return `🤖 ${curName} está jogando…`;
  if (!myTurn) return 'Aguardando…';
  if (state.phase === 'moveBlocker') return 'Mova o bloqueador — clique em um hex.';
  if (state.phase === 'setup1' || state.phase === 'setup2') {
    return state.setupLastVertex ? 'Coloque sua estrada.' : 'Coloque sua vila.';
  }
  if (state.phase === 'roll') return 'Sua vez — role os dados!';
  if (state.phase === 'main') return 'Sua vez — construa, comercie ou encerre.';
  return '';
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
      return 'trade';
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

function describeEvent(e: GameEvent, state: GameState): string {
  switch (e.t) {
    case 'diceRolled':
      return `🎲 ${e.dice[0]} + ${e.dice[1]} = ${e.sum}`;
    case 'produced': {
      const parts: string[] = [];
      for (const p of state.players) {
        const g = e.gains[p.color];
        const items = (Object.entries(g) as [Resource, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${n}${RESOURCE_ICON[r]}`);
        if (items.length) parts.push(`${PLAYER_LABEL[p.color]}: ${items.join(' ')}`);
      }
      return parts.length ? `Produção — ${parts.join(' · ')}` : 'Produção — nada';
    }
    case 'built':
      return `${PLAYER_LABEL[e.owner]} construiu ${{ road: 'estrada', settlement: 'vila', city: 'cidade' }[e.kind]}`;
    case 'progressCardBought':
      return `${PLAYER_LABEL[e.owner]} comprou uma carta de progresso`;
    case 'cardPlayed':
      return `${PLAYER_LABEL[e.owner]} jogou ${CARD_LABEL[e.card]}`;
    case 'monopoly':
      return `📦 ${PLAYER_LABEL[e.owner]} monopolizou ${RESOURCE_LABEL[e.resource]} (+${e.taken})`;
    case 'blockerMoved':
      return e.stoleFrom ? `Bloqueador movido — roubou de ${PLAYER_LABEL[e.stoleFrom]}` : 'Bloqueador movido';
    case 'mustDiscard':
      return `Rolou 7 — descarte: ${e.players.map((p) => PLAYER_LABEL[p.color]).join(', ')}`;
    case 'discarded':
      return `${PLAYER_LABEL[e.owner]} descartou`;
    case 'bankTrade':
      return `${PLAYER_LABEL[e.owner]} trocou ${e.rate} ${RESOURCE_LABEL[e.give]} por 1 ${RESOURCE_LABEL[e.want]}`;
    case 'tradeProposed':
      return `🤝 ${PLAYER_LABEL[e.from]} propôs uma troca`;
    case 'tradeCountered':
      return `↩ ${PLAYER_LABEL[e.from]} fez uma contraproposta`;
    case 'tradeResponded':
      return `${PLAYER_LABEL[e.player]} ${e.accept ? 'aceitou' : 'recusou'} a troca`;
    case 'tradeExecuted':
      return `✅ Troca: ${PLAYER_LABEL[e.from]} ↔ ${PLAYER_LABEL[e.with]}`;
    case 'tradeCancelled':
      return 'Troca cancelada';
    case 'longestRoad':
      return e.owner ? `📏 Estrada Mais Longa: ${PLAYER_LABEL[e.owner]}` : 'Estrada Mais Longa perdida';
    case 'largestArmy':
      return e.owner ? `⚔️ Maior Exército: ${PLAYER_LABEL[e.owner]}` : 'Maior Exército perdido';
    case 'turnEnded':
      return `▶ Vez de ${PLAYER_LABEL[e.next]}`;
    case 'gameWon':
      return `🏆 ${PLAYER_LABEL[e.winner]} venceu!`;
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
