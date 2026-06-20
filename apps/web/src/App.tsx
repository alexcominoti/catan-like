import { useMemo, useState } from 'react';
import {
  createInitialState,
  reduce,
  scoreOf,
  handTotal,
  RESOURCES,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerColor,
  type Resource,
} from '@hexgame/engine';
import { Board, type InteractionMode } from './board/Board.js';
import {
  PLAYER_FILL,
  PLAYER_LABEL,
  RESOURCE_ICON,
  RESOURCE_LABEL,
} from './game/theme.js';

function newGame(): GameState {
  return createInitialState({ seed: Math.floor(Math.random() * 0x7fffffff) });
}

export function App() {
  const [state, setState] = useState<GameState>(newGame);
  const [log, setLog] = useState<string[]>(['Partida iniciada. Coloquem as vilas iniciais.']);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<InteractionMode>('idle');
  const [give, setGive] = useState<Resource>('wood');
  const [want, setWant] = useState<Resource>('brick');

  const effMode: InteractionMode = useMemo(() => {
    if (state.phase === 'setup1' || state.phase === 'setup2') {
      return state.setupLastVertex ? 'placeRoad' : 'placeSettlement';
    }
    if (state.phase === 'moveBlocker') return 'moveBlocker';
    if (state.phase === 'main') return mode;
    return 'idle';
  }, [state.phase, state.setupLastVertex, mode]);

  function dispatch(action: Action, by: PlayerColor = state.currentPlayer) {
    const res = reduce(state, by, action);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setState(res.state);
    const lines = res.events.map((e) => describeEvent(e, res.state));
    setLog((prev) => [...lines.filter(Boolean), ...prev].slice(0, 200));
    if (res.events.some((e) => e.t === 'turnEnded' || e.t === 'gameWon')) setMode('idle');
  }

  // --- Cliques no tabuleiro -------------------------------------------------
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

  const cur = getPlayer(state, state.currentPlayer);
  const isMain = state.phase === 'main';
  const isRoll = state.phase === 'roll';

  return (
    <div className="app">
      <header className="header">
        <h1>⬡ HexGame</h1>
        <div className="phase">
          {phaseLabel(state)} · Vez de{' '}
          <strong style={{ color: PLAYER_FILL[state.currentPlayer] }}>
            {PLAYER_LABEL[state.currentPlayer]}
          </strong>
        </div>
        <button onClick={() => { setState(newGame()); setLog(['Nova partida.']); setMode('idle'); setError(null); }}>
          Novo jogo
        </button>
      </header>

      <div className="board-wrap">
        <Board state={state} mode={effMode} onVertex={onVertex} onEdge={onEdge} onHex={onHex} />
      </div>

      <aside className="sidebar">
        <div className="card">
          <h2>Jogadores</h2>
          {state.players.map((p) => (
            <div key={p.color} className={`player-row${p.color === state.currentPlayer ? ' active' : ''}`}>
              <span className="swatch" style={{ background: PLAYER_FILL[p.color] }} />
              <span className="name">{p.name}</span>
              {state.longestRoad.owner === p.color && <span className="badge">Estrada</span>}
              {state.largestArmy.owner === p.color && <span className="badge">Exército</span>}
              <span className="pts">{scoreOf(state, p.color)} pts · {handTotal(p)}🂠</span>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Mão de {PLAYER_LABEL[state.currentPlayer]}</h2>
          <div className="hand">
            {RESOURCES.map((r) => (
              <span key={r} className="res-chip" title={RESOURCE_LABEL[r]}>
                {RESOURCE_ICON[r]} {cur.hand[r]}
              </span>
            ))}
          </div>
          {cur.progressCards.length > 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 0 }}>
              Cartas de progresso: {cur.progressCards.length}
            </p>
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
          <div className="log">
            {log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      </aside>

      <div className="actionbar">
        {state.phase === 'ended' ? (
          <span className="hint">
            🏆 {PLAYER_LABEL[state.winner!]} venceu! Clique em “Novo jogo”.
          </span>
        ) : state.phase === 'discard' ? (
          <DiscardControls state={state} dispatch={dispatch} />
        ) : effMode === 'moveBlocker' ? (
          <span className="hint">Clique em um hex para mover o bloqueador (rouba de um vizinho).</span>
        ) : effMode === 'placeSettlement' ? (
          <span className="hint">Setup: clique em um vértice para colocar sua vila.</span>
        ) : effMode === 'placeRoad' ? (
          <span className="hint">Setup: clique em uma aresta ligada à vila para a estrada.</span>
        ) : (
          <>
            <button className="primary" disabled={!isRoll} onClick={() => dispatch({ t: 'rollDice' })}>
              🎲 Rolar
            </button>
            <button className={modeBtn(mode, 'buildRoad')} disabled={!isMain} onClick={() => toggle('buildRoad')}>
              Estrada
            </button>
            <button className={modeBtn(mode, 'buildSettlement')} disabled={!isMain} onClick={() => toggle('buildSettlement')}>
              Vila
            </button>
            <button className={modeBtn(mode, 'buildCity')} disabled={!isMain} onClick={() => toggle('buildCity')}>
              Cidade
            </button>
            <button disabled={!isMain} onClick={() => dispatch({ t: 'buyProgressCard' })}>
              Comprar carta
            </button>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <select value={give} onChange={(e) => setGive(e.target.value as Resource)} disabled={!isMain}>
                {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_ICON[r]}×4</option>)}
              </select>
              →
              <select value={want} onChange={(e) => setWant(e.target.value as Resource)} disabled={!isMain}>
                {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_ICON[r]}</option>)}
              </select>
              <button disabled={!isMain} onClick={() => dispatch({ t: 'tradeBank', give, want })}>4:1</button>
            </span>
            <button disabled={!isMain} onClick={() => dispatch({ t: 'endTurn' })}>Fim de turno</button>
            {state.dice && <span className="dice">🎲 {state.dice[0]} + {state.dice[1]}</span>}
          </>
        )}
        {error && <span className="error">⚠ {error}</span>}
      </div>
    </div>
  );

  function toggle(m: InteractionMode) {
    setMode((cur) => (cur === m ? 'idle' : m));
    setError(null);
  }
}

function modeBtn(mode: InteractionMode, m: InteractionMode): string {
  return mode === m ? 'active' : '';
}

function DiscardControls({
  state,
  dispatch,
}: {
  state: GameState;
  dispatch: (a: Action, by?: PlayerColor) => void;
}) {
  const pending = Object.entries(state.pendingDiscards) as [PlayerColor, number][];
  return (
    <>
      <span className="hint">
        Rolou 7! Descarte pela metade:{' '}
        {pending.map(([c, n]) => `${PLAYER_LABEL[c]} (${n})`).join(', ')}
      </span>
      {pending.map(([color, count]) => (
        <button
          key={color}
          onClick={() => dispatch({ t: 'discard', resources: autoDiscard(state, color, count) }, color)}
        >
          Descartar {count} de {PLAYER_LABEL[color]}
        </button>
      ))}
    </>
  );
}

/** Escolhe quais cartas descartar: tira das pilhas mais abundantes primeiro. */
function autoDiscard(
  state: GameState,
  color: PlayerColor,
  count: number,
): Partial<Record<Resource, number>> {
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

function describeEvent(e: GameEvent, state: GameState): string {
  switch (e.t) {
    case 'diceRolled':
      return `🎲 ${e.dice[0]} + ${e.dice[1]} = ${e.sum}`;
    case 'produced': {
      const parts: string[] = [];
      for (const p of state.players) {
        const g = e.gains[p.color];
        const items = (Object.entries(g) as [Resource, number][])
          .filter(([, n]) => n > 0)
          .map(([r, n]) => `${n}${RESOURCE_ICON[r]}`);
        if (items.length) parts.push(`${PLAYER_LABEL[p.color]}: ${items.join(' ')}`);
      }
      return parts.length ? `Produção — ${parts.join(' · ')}` : 'Produção — nada';
    }
    case 'built':
      return `${PLAYER_LABEL[e.owner]} construiu ${{ road: 'estrada', settlement: 'vila', city: 'cidade' }[e.kind]}`;
    case 'progressCardBought':
      return `${PLAYER_LABEL[e.owner]} comprou uma carta de progresso`;
    case 'blockerMoved':
      return e.stoleFrom
        ? `Bloqueador movido — roubou de ${PLAYER_LABEL[e.stoleFrom]}`
        : 'Bloqueador movido';
    case 'mustDiscard':
      return `Rolou 7 — descarte: ${e.players.map((p) => PLAYER_LABEL[p.color]).join(', ')}`;
    case 'discarded':
      return `${PLAYER_LABEL[e.owner]} descartou`;
    case 'bankTrade':
      return `${PLAYER_LABEL[e.owner]} trocou 4 ${RESOURCE_LABEL[e.give]} por 1 ${RESOURCE_LABEL[e.want]}`;
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
