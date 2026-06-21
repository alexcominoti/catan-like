import { useEffect, useMemo, useState } from 'react';
import {
  createInitialState,
  reduce,
  scoreOf,
  handTotal,
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
import { planBotAction } from '@hexgame/bot';
import { Board, type InteractionMode } from './board/Board.js';
import { Dice } from './ui/Dice.js';
import { Toasts, useToasts, type ToastTone } from './ui/Toasts.js';
import type { GameConfig } from './ui/Lobby.js';
import { PLAYER_FILL, PLAYER_LABEL, RESOURCE_ICON, RESOURCE_LABEL } from './game/theme.js';

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

const PLAYABLE_CARDS: { card: Exclude<ProgressCard, 'victoryPoint'>; label: string }[] = [
  { card: 'knight', label: '⚔️ Cavaleiro' },
  { card: 'roadBuilding', label: '🛣️ 2 Estradas' },
  { card: 'yearOfPlenty', label: '🎁 +2 Recursos' },
  { card: 'monopoly', label: '📦 Monopólio' },
];

export function Game({ config, onExit }: { config: GameConfig; onExit: () => void }) {
  const [state, setState] = useState<GameState>(() =>
    createInitialState({
      seed: config.seed,
      players: config.players,
      numberLayout: config.numberLayout,
      desert: config.desert,
    }),
  );
  const [log, setLog] = useState<string[]>(['Partida iniciada. Coloquem as vilas iniciais.']);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<InteractionMode>('idle');
  const [give, setGive] = useState<Resource>('wood');
  const [want, setWant] = useState<Resource>('brick');
  const [arming, setArming] = useState<'yearOfPlenty' | 'monopoly' | 'trade' | null>(null);
  const [yopPicks, setYopPicks] = useState<Resource[]>([]);
  const [tradeGive, setTradeGive] = useState<Record<Resource, number>>(zeroRes);
  const [tradeWant, setTradeWant] = useState<Record<Resource, number>>(zeroRes);
  const [help, setHelp] = useState(false);
  const { toasts, push } = useToasts();

  const isBot = useMemo(() => {
    const set = new Set(config.bots);
    return (c: PlayerColor) => set.has(c);
  }, [config.bots]);
  const botTurn = isBot(state.currentPlayer);

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
        setError(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-jogo dos bots: a cada mudanca de estado, se ha uma acao de bot pendente
  // (turno do bot, descarte, mover bloqueador, ou aceitar troca), agenda e aplica.
  useEffect(() => {
    const move = planBotAction(state, isBot);
    if (!move) return;
    const delay = state.phase === 'setup1' || state.phase === 'setup2' ? 360 : 620;
    const id = setTimeout(() => dispatch(move.action, move.by), delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isBot]);

  function onVertex(vid: string) {
    if (effMode === 'placeSettlement') dispatch({ t: 'placeSettlement', vertexId: vid });
    else if (effMode === 'buildSettlement') dispatch({ t: 'buildSettlement', vertexId: vid });
    else if (effMode === 'buildCity') dispatch({ t: 'buildCity', vertexId: vid });
  }
  function onEdge(eid: string) {
    if (effMode === 'placeRoad') dispatch({ t: 'placeRoad', edgeId: eid });
    else if (effMode === 'buildRoad') dispatch({ t: 'buildRoad', edgeId: eid });
  }
  function onHex(hid: string) {
    if (effMode !== 'moveBlocker') return;
    const hex = state.board.hexes[hid]!;
    const me = state.currentPlayer;
    const victim = hex.corners
      .map((vid) => state.buildings[vid]?.owner)
      .find((o): o is PlayerColor => !!o && o !== me && handTotal(getPlayer(state, o)) > 0);
    dispatch({ t: 'moveBlocker', hexId: hid, ...(victim ? { stealFrom: victim } : {}) });
  }

  function canPlay(card: ProgressCard): boolean {
    const p = getPlayer(state, state.currentPlayer);
    const have = p.progressCards.filter((c) => c === card).length;
    const bought = p.progressCardsBoughtThisTurn.filter((c) => c === card).length;
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

  const cur = getPlayer(state, state.currentPlayer);
  const isMain = state.phase === 'main';
  const isRoll = state.phase === 'roll';
  const bestRate = maritimeRate(state, state.currentPlayer, give);
  const devCounts = countCards(cur.progressCards);
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
          <button onClick={() => setHelp(true)}>❔ Ajuda</button>
          <button onClick={onExit}>Novo jogo</button>
        </div>
      </header>

      <div className="board-wrap" style={{ borderColor: playerColor }}>
        <Board state={state} mode={effMode} onVertex={onVertex} onEdge={onEdge} onHex={onHex} />
      </div>

      <aside className="sidebar">
        <div className="card">
          <h2>Jogadores</h2>
          {state.players.map((p) => (
            <div key={p.color} className={`player-row${p.color === state.currentPlayer ? ' active' : ''}`}>
              <span className="swatch" style={{ background: PLAYER_FILL[p.color] }} />
              <span className="name">{p.name}{isBot(p.color) && <span title="Bot"> 🤖</span>}</span>
              {state.longestRoad.owner === p.color && <span className="badge" title="Estrada Mais Longa">📏</span>}
              {state.largestArmy.owner === p.color && <span className="badge" title="Maior Exército">⚔️</span>}
              <span className="pts">{scoreOf(state, p.color)}⭐ · {handTotal(p)}🂠 · {p.progressCards.length}🃏</span>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Mão de {PLAYER_LABEL[state.currentPlayer]}</h2>
          <div className="hand">
            {RESOURCES.map((r) => (
              <span key={r} className="res-chip" title={RESOURCE_LABEL[r]}>{RESOURCE_ICON[r]} {cur.hand[r]}</span>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Cartas de progresso</h2>
          {cur.progressCards.length === 0 ? (
            <p className="muted-note">Nenhuma carta.</p>
          ) : (
            <div className="dev-cards">
              {PLAYABLE_CARDS.map(({ card, label }) =>
                devCounts[card] ? (
                  <button key={card} disabled={!canPlay(card)} onClick={() => playCard(card)}>{label} ×{devCounts[card]}</button>
                ) : null,
              )}
              {devCounts.victoryPoint ? <span className="res-chip">⭐ Ponto ×{devCounts.victoryPoint}</span> : null}
            </div>
          )}
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

      <div className="actionbar">
        {state.phase === 'ended' ? (
          <span className="hint">🏆 {PLAYER_LABEL[state.winner!]} venceu! Clique em “Novo jogo”.</span>
        ) : state.phase === 'discard' ? (
          <DiscardControls state={state} dispatch={dispatch} />
        ) : botTurn ? (
          <span className="hint">🤖 {cur.name} está jogando…</span>
        ) : effMode === 'moveBlocker' ? (
          <span className="hint">Clique em um hex para mover o bloqueador (rouba de um vizinho).</span>
        ) : effMode === 'placeSettlement' ? (
          <span className="hint">Setup: clique em um vértice para colocar sua vila.</span>
        ) : effMode === 'placeRoad' ? (
          <span className="hint">Setup: clique em uma aresta ligada à vila para a estrada.</span>
        ) : (
          <>
            <button className="primary" disabled={!isRoll} onClick={() => dispatch({ t: 'rollDice' })}>🎲 Rolar</button>
            <BuildButton label="Estrada" cost={COSTS.road} active={mode === 'buildRoad'} hand={cur.hand}
              enabled={(isMain && canAffordUI(cur.hand, COSTS.road)) || state.pendingFreeRoads > 0}
              free={state.pendingFreeRoads > 0} onClick={() => toggle('buildRoad')} />
            <BuildButton label="Vila" cost={COSTS.settlement} active={mode === 'buildSettlement'} hand={cur.hand}
              enabled={isMain && canAffordUI(cur.hand, COSTS.settlement)} onClick={() => toggle('buildSettlement')} />
            <BuildButton label="Cidade" cost={COSTS.city} active={mode === 'buildCity'} hand={cur.hand}
              enabled={isMain && canAffordUI(cur.hand, COSTS.city)} onClick={() => toggle('buildCity')} />
            <BuildButton label="Carta" cost={COSTS.progressCard} hand={cur.hand}
              enabled={isMain && canAffordUI(cur.hand, COSTS.progressCard) && state.devDeck.length > 0}
              onClick={() => dispatch({ t: 'buyProgressCard' })} />
            <span className="trade-bank">
              <select value={give} onChange={(e) => setGive(e.target.value as Resource)} disabled={!isMain}>
                {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_ICON[r]}×{bestRate}</option>)}
              </select>
              →
              <select value={want} onChange={(e) => setWant(e.target.value as Resource)} disabled={!isMain}>
                {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_ICON[r]}</option>)}
              </select>
              <button disabled={!isMain || cur.hand[give] < bestRate} onClick={() => dispatch({ t: 'tradeBank', give, want })}>{bestRate}:1</button>
            </span>
            <button disabled={!isMain} onClick={() => setArming('trade')}>🤝 Propor troca</button>
            <button disabled={!isMain} onClick={() => dispatch({ t: 'endTurn' })}>Fim de turno</button>
            <Dice dice={state.dice} />
          </>
        )}
        {error && <span className="error">⚠ {error}</span>}
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
      {arming === 'trade' && (
        <TradeBuilderModal state={state} tradeGive={tradeGive} tradeWant={tradeWant}
          setTradeGive={setTradeGive} setTradeWant={setTradeWant}
          onPropose={(to) => dispatch({ t: 'proposeTrade', give: tradeGive, want: tradeWant, to })}
          onClose={resetTransient} />
      )}
      {state.activeTrade && <ActiveTradeModal state={state} dispatch={dispatch} />}
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
  state, tradeGive, tradeWant, setTradeGive, setTradeWant, onPropose, onClose,
}: {
  state: GameState;
  tradeGive: Record<Resource, number>;
  tradeWant: Record<Resource, number>;
  setTradeGive: (v: Record<Resource, number>) => void;
  setTradeWant: (v: Record<Resource, number>) => void;
  onPropose: (to: PlayerColor[]) => void;
  onClose: () => void;
}) {
  const me = state.currentPlayer;
  const others = state.players.filter((p) => p.color !== me).map((p) => p.color);
  const [to, setTo] = useState<PlayerColor[]>(others);
  const cur = state.players.find((p) => p.color === me)!;
  const total = (m: Record<Resource, number>) => RESOURCES.reduce((s, r) => s + m[r], 0);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Propor troca</h3>
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
        <div className="modal-actions">
          <button className="primary" disabled={(total(tradeGive) === 0 && total(tradeWant) === 0) || to.length === 0}
            onClick={() => onPropose(to)}>Propor</button>
          <button onClick={onClose}>Cancelar (ESC)</button>
        </div>
      </div>
    </div>
  );
}

function ActiveTradeModal({ state, dispatch }: { state: GameState; dispatch: (a: Action, by?: PlayerColor) => boolean }) {
  const t = state.activeTrade!;
  const fmt = (m: Partial<Record<Resource, number>>) =>
    (Object.entries(m) as [Resource, number][]).filter(([, n]) => n > 0).map(([r, n]) => `${n}${RESOURCE_ICON[r]}`).join(' ') || '—';
  return (
    <div className="overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Troca proposta por {PLAYER_LABEL[t.from]}</h3>
        <p className="trade-summary">Dá <b>{fmt(t.give)}</b> &nbsp;→&nbsp; quer <b>{fmt(t.want)}</b></p>
        <div className="trade-responders">
          {t.to.map((c) => {
            const accepted = t.accepted.includes(c);
            return (
              <div key={c} className="trade-row">
                <span><span className="swatch" style={{ background: PLAYER_FILL[c] }} /> {PLAYER_LABEL[c]} {accepted && '✅'}</span>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <button onClick={() => dispatch({ t: 'respondTrade', accept: true }, c)}>Aceitar</button>
                  <button onClick={() => dispatch({ t: 'respondTrade', accept: false }, c)}>Recusar</button>
                  <button className="primary" disabled={!accepted} onClick={() => dispatch({ t: 'confirmTrade', with: c }, t.from)}>Fechar</button>
                </span>
              </div>
            );
          })}
        </div>
        <div className="modal-actions">
          <button onClick={() => dispatch({ t: 'cancelTrade' }, t.from)}>Cancelar proposta</button>
        </div>
      </div>
    </div>
  );
}

function DiscardControls({ state, dispatch }: { state: GameState; dispatch: (a: Action, by?: PlayerColor) => boolean }) {
  const pending = Object.entries(state.pendingDiscards) as [PlayerColor, number][];
  return (
    <>
      <span className="hint">Rolou 7! Descarte pela metade: {pending.map(([c, n]) => `${PLAYER_LABEL[c]} (${n})`).join(', ')}</span>
      {pending.map(([color, count]) => (
        <button key={color} onClick={() => dispatch({ t: 'discard', resources: autoDiscard(state, color, count) }, color)}>
          Descartar {count} de {PLAYER_LABEL[color]}
        </button>
      ))}
    </>
  );
}

function autoDiscard(state: GameState, color: PlayerColor, count: number): Partial<Record<Resource, number>> {
  const p = getPlayer(state, color);
  const hand: Record<Resource, number> = { ...p.hand };
  const out: Partial<Record<Resource, number>> = {};
  for (let i = 0; i < count; i++) {
    let best: Resource = RESOURCES[0]!;
    for (const r of RESOURCES) if (hand[r] > hand[best]) best = r;
    hand[best] -= 1;
    out[best] = (out[best] ?? 0) + 1;
  }
  return out;
}

function countCards(cards: ProgressCard[]): Record<ProgressCard, number> {
  const out = { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0, victoryPoint: 0 };
  for (const c of cards) out[c] += 1;
  return out;
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
