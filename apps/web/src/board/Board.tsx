import { useMemo, useState } from 'react';
import {
  COSTS,
  distanceRuleOk,
  robberAllowed,
  roadConnects,
  vertexTouchesPlayerRoad,
  type Action,
  type GameState,
  type PlayerColor,
  type Resource,
  type Terrain,
} from '@hexgame/engine';
import { PLAYER_FILL, RESOURCE_ICON, TERRAIN_FILL } from '../game/theme.js';

export type InteractionMode =
  | 'idle'
  | 'placeSettlement'
  | 'placeRoad'
  | 'mainBuild' // fase principal: todos os alvos (estrada/vila/cidade) ativos por hover
  | 'buildRoad'
  | 'buildSettlement'
  | 'buildCity'
  | 'moveBlocker';

interface BoardProps {
  state: GameState;
  mode: InteractionMode;
  /** Vertice sugerido (melhor spot) para destacar no setup. */
  hintVertex?: string | null;
  /** Confirmar uma construcao (o Board ja sabe a acao do spot). */
  onBuild: (action: Action) => void;
  onHex: (hexId: string) => void;
}

interface Pt {
  x: number;
  y: number;
}

type Cost = Partial<Record<Resource, number>>;
interface BuildTarget {
  action: Action;
  cost: Cost;
  kind: 'settlement' | 'city' | 'road';
}

const NO_COST: Cost = {};

/** Alvo de construcao num vertice para o modo atual (ou null). */
function vertexTarget(state: GameState, mode: InteractionMode, vid: string, me: PlayerColor): BuildTarget | null {
  const b = state.buildings[vid];
  const canSettle = distanceRuleOk(state, vid) && vertexTouchesPlayerRoad(state, me, vid);
  const isOwnSettlement = !!b && b.owner === me && b.kind === 'settlement';
  switch (mode) {
    case 'placeSettlement':
      return distanceRuleOk(state, vid) ? { action: { t: 'placeSettlement', vertexId: vid }, cost: NO_COST, kind: 'settlement' } : null;
    case 'buildSettlement':
      return canSettle ? { action: { t: 'buildSettlement', vertexId: vid }, cost: COSTS.settlement, kind: 'settlement' } : null;
    case 'buildCity':
      return isOwnSettlement ? { action: { t: 'buildCity', vertexId: vid }, cost: COSTS.city, kind: 'city' } : null;
    case 'mainBuild':
      if (isOwnSettlement) return { action: { t: 'buildCity', vertexId: vid }, cost: COSTS.city, kind: 'city' };
      if (!b && canSettle) return { action: { t: 'buildSettlement', vertexId: vid }, cost: COSTS.settlement, kind: 'settlement' };
      return null;
    default:
      return null;
  }
}

/** Alvo de construcao numa aresta para o modo atual (ou null). */
function edgeTarget(state: GameState, mode: InteractionMode, eid: string, me: PlayerColor): BuildTarget | null {
  if (state.roads[eid]) return null;
  if (mode === 'placeRoad') {
    const ok = !!state.setupLastVertex && state.board.edges[eid]!.v.includes(state.setupLastVertex);
    return ok ? { action: { t: 'placeRoad', edgeId: eid }, cost: NO_COST, kind: 'road' } : null;
  }
  if (mode === 'buildRoad' || mode === 'mainBuild') {
    return roadConnects(state, me, eid) ? { action: { t: 'buildRoad', edgeId: eid }, cost: COSTS.road, kind: 'road' } : null;
  }
  return null;
}

/** O jogador da vez consegue pagar este custo? */
function affords(hand: Record<Resource, number> | undefined, cost: Cost): boolean {
  if (!hand) return false;
  return (Object.entries(cost) as [Resource, number][]).every(([r, n]) => hand[r] >= n);
}

/** Escala os cantos de um hex em torno do seu centro. */
function scaled(corners: Pt[], cx: number, cy: number, k: number): Pt[] {
  return corners.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

/** Caminho de poligono com cantos arredondados. */
function roundedPath(points: Pt[], r: number): string {
  const n = points.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const cur = points[i]!;
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    const v1 = norm({ x: prev.x - cur.x, y: prev.y - cur.y });
    const v2 = norm({ x: next.x - cur.x, y: next.y - cur.y });
    const p1 = { x: cur.x + v1.x * r, y: cur.y + v1.y * r };
    const p2 = { x: cur.x + v2.x * r, y: cur.y + v2.y * r };
    d += i === 0 ? `M ${p1.x} ${p1.y}` : `L ${p1.x} ${p1.y}`;
    d += ` Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`;
  }
  return d + ' Z';
}

function norm(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

export function Board({ state, mode, hintVertex, onBuild, onHex }: BoardProps) {
  const { board, buildings, roads, blocker } = state;
  const me = state.currentPlayer;
  const myHand = state.players.find((p) => p.color === me)?.hand;
  const hexMode = mode === 'moveBlocker';
  // Ladrao amigavel: so destaca/permite hexes validos (se houver alternativa).
  const enforceFriendly =
    hexMode && state.friendlyRobber &&
    board.hexOrder.some((h) => h !== blocker.hexId && robberAllowed(state, h, me));
  const canBlock = (hid: string) =>
    hexMode && hid !== blocker.hexId && (!enforceFriendly || robberAllowed(state, hid, me));
  const [hoverV, setHoverV] = useState<string | null>(null);
  const [hoverE, setHoverE] = useState<string | null>(null);
  const [hoverH, setHoverH] = useState<string | null>(null);

  const cornersOf = useMemo(() => {
    const map: Record<string, Pt[]> = {};
    for (const hid of board.hexOrder) {
      map[hid] = board.hexes[hid]!.corners.map((vid) => ({ x: board.vertices[vid]!.x, y: board.vertices[vid]!.y }));
    }
    return map;
  }, [board]);

  const hexPaths = useMemo(() => {
    const map: Record<string, string> = {};
    for (const hid of board.hexOrder) map[hid] = roundedPath(cornersOf[hid]!, 10);
    return map;
  }, [board, cornersOf]);

  const frame = useMemo(() => {
    const xs = board.vertexOrder.map((v) => board.vertices[v]!.x);
    const ys = board.vertexOrder.map((v) => board.vertices[v]!.y);
    const pad = 84;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - minX + pad;
    const h = Math.max(...ys) - minY + pad;
    return { viewBox: `${minX} ${minY} ${w} ${h}`, minX, minY, w, h };
  }, [board]);
  const viewBox = frame.viewBox;

  return (
    <svg viewBox={viewBox} role="img" aria-label="Tabuleiro hexagonal">
      <defs>
        <radialGradient id="hexLight" cx="35%" cy="22%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.32} />
          <stop offset="55%" stopColor="#ffffff" stopOpacity={0.05} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="hexShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="55%" stopColor="#000000" stopOpacity={0} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0.26} />
        </linearGradient>
        <radialGradient id="coastGrad" cx="50%" cy="42%" r="75%">
          <stop offset="0%" stopColor="#efd9a6" />
          <stop offset="100%" stopColor="#d9b770" />
        </radialGradient>
        <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbf3dd" />
          <stop offset="100%" stopColor="#e9d9af" />
        </linearGradient>
        <filter id="waterBlur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" floodColor="#000000" floodOpacity="0.55" />
        </filter>
        {/* Grao fino para textura dos terrenos */}
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
        </filter>
        {/* Manchas maiores (variacao organica) */}
        <filter id="mottle">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" stitchTiles="stitch" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
        </filter>
        <clipPath id="hexClip">
          {board.hexOrder.map((hid) => (
            <path key={hid} d={hexPaths[hid]} />
          ))}
        </clipPath>
      </defs>

      {/* Mar: agua profunda -> rasa, orla de espuma e praia de areia (litoral suave) */}
      <g filter="url(#waterBlur)" opacity={0.6}>
        {board.hexOrder.map((hid) => {
          const h = board.hexes[hid]!;
          return <path key={hid} d={roundedPath(scaled(cornersOf[hid]!, h.cx, h.cy, 1.74), 30)} fill="#2c86c4" />;
        })}
      </g>
      <g filter="url(#waterBlur)" opacity={0.85}>
        {board.hexOrder.map((hid) => {
          const h = board.hexes[hid]!;
          return <path key={hid} d={roundedPath(scaled(cornersOf[hid]!, h.cx, h.cy, 1.46), 28)} fill="#58c0ea" />;
        })}
      </g>
      <g filter="url(#waterBlur)" opacity={0.9}>
        {board.hexOrder.map((hid) => {
          const h = board.hexes[hid]!;
          return <path key={hid} d={roundedPath(scaled(cornersOf[hid]!, h.cx, h.cy, 1.30), 26)} fill="#b3e6f1" />;
        })}
      </g>
      {/* Praia (areia) — banda suave em volta da ilha */}
      <g>
        {board.hexOrder.map((hid) => {
          const h = board.hexes[hid]!;
          return <path key={hid} d={roundedPath(scaled(cornersOf[hid]!, h.cx, h.cy, 1.19), 24)} fill="url(#coastGrad)" />;
        })}
      </g>
      <g opacity={0.45}>
        {board.hexOrder.map((hid) => {
          const h = board.hexes[hid]!;
          return <path key={hid} d={roundedPath(scaled(cornersOf[hid]!, h.cx, h.cy, 1.07), 18)} fill="#c4a06a" />;
        })}
      </g>

      {/* Portos como barquinhos ancorados, com docas para os 2 vertices */}
      {board.ports.map((port) => {
        const a = board.vertices[port.vertices[0]]!;
        const b = board.vertices[port.vertices[1]]!;
        const lx = port.x + port.nx * 36;
        const ly = port.y + port.ny * 36;
        return (
          <g key={port.id} pointerEvents="none">
            <line x1={a.x} y1={a.y} x2={lx} y2={ly} stroke="#b07a3e" strokeWidth={3} strokeLinecap="round" strokeDasharray="1 5" />
            <line x1={b.x} y1={b.y} x2={lx} y2={ly} stroke="#b07a3e" strokeWidth={3} strokeLinecap="round" strokeDasharray="1 5" />
            <PortBoat x={lx} y={ly} type={port.type} />
          </g>
        );
      })}

      {/* Hexes: fundo, motivo, luz/sombra e borda */}
      {board.hexOrder.map((hid) => {
        const hex = board.hexes[hid]!;
        const path = hexPaths[hid]!;
        return (
          <g key={hid}>
            <path d={path} fill={TERRAIN_FILL[hex.terrain]} />
            <TerrainMotif terrain={hex.terrain} cx={hex.cx} cy={hex.cy} />
            <path d={path} fill="url(#hexLight)" pointerEvents="none" />
            <path d={path} fill="url(#hexShade)" pointerEvents="none" />
            {/* Modo mover ladrao: escurece os proibidos, destaca os disponiveis */}
            {hexMode && enforceFriendly && !canBlock(hid) && (
              <path d={path} fill="rgba(0,0,0,0.3)" pointerEvents="none" />
            )}
            {canBlock(hid) && (
              <g pointerEvents="none">
                <path d={path} fill={hoverH === hid ? 'rgba(255,224,138,0.42)' : 'rgba(255,224,138,0.2)'} />
                <path d={path} className="robber-ring" fill="none" stroke="#f3c44b" strokeWidth={3} strokeLinejoin="round" />
                {hoverH === hid && <Blocker cx={hex.cx} cy={hex.cy - 26} />}
              </g>
            )}
            <path
              d={path}
              fill="transparent"
              stroke={canBlock(hid) ? 'transparent' : 'rgba(0,0,0,0.38)'}
              strokeWidth={2}
              strokeLinejoin="round"
              style={{ cursor: canBlock(hid) ? 'pointer' : 'default' }}
              onClick={() => canBlock(hid) && onHex(hid)}
              onMouseEnter={() => canBlock(hid) && setHoverH(hid)}
              onMouseLeave={() => setHoverH((c) => (c === hid ? null : c))}
            />
          </g>
        );
      })}

      {/* Textura: grao + manchas, recortados na silhueta dos hexes */}
      <g clipPath="url(#hexClip)" pointerEvents="none">
        <rect x={frame.minX} y={frame.minY} width={frame.w} height={frame.h} filter="url(#mottle)" opacity={0.16} style={{ mixBlendMode: 'overlay' }} />
        <rect x={frame.minX} y={frame.minY} width={frame.w} height={frame.h} filter="url(#grain)" opacity={0.22} style={{ mixBlendMode: 'soft-light' }} />
        <rect x={frame.minX} y={frame.minY} width={frame.w} height={frame.h} filter="url(#grain)" opacity={0.1} style={{ mixBlendMode: 'multiply' }} />
      </g>

      {/* Tokens e bloqueador (nitidos, acima da textura) */}
      {board.hexOrder.map((hid) => {
        const hex = board.hexes[hid]!;
        return (
          <g key={hid} pointerEvents="none">
            {hex.number !== null && <NumberToken cx={hex.cx} cy={hex.cy + 6} n={hex.number} />}
            {blocker.hexId === hid && <Blocker cx={hex.cx} cy={hex.cy - 26} />}
          </g>
        );
      })}

      {/* Arestas (estradas + alvos validos) */}
      {board.edgeOrder.map((eid) => {
        const e = board.edges[eid]!;
        const a = board.vertices[e.v[0]]!;
        const b = board.vertices[e.v[1]]!;
        const road = roads[eid];
        if (road) {
          return (
            <g key={eid} className="piece-enter">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0c1118" strokeWidth={11} strokeLinecap="round" opacity={0.55} />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0c1118" strokeWidth={10} strokeLinecap="round" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PLAYER_FILL[road.owner]} strokeWidth={7} strokeLinecap="round" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeOpacity={0.28} strokeWidth={2.2} strokeLinecap="round" />
            </g>
          );
        }
        const target = edgeTarget(state, mode, eid, me);
        if (!target) return null;
        const hovered = hoverE === eid;
        const afford = affords(myHand, target.cost);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g key={eid}
            onMouseEnter={() => { setHoverE(eid); setHoverV(null); }}
            onMouseLeave={() => setHoverE((c) => (c === eid ? null : c))}>
            {hovered ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PLAYER_FILL[me]} strokeOpacity={afford ? 0.85 : 0.4} strokeWidth={9} strokeLinecap="round" pointerEvents="none" />
            ) : (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={6} strokeDasharray="2 7" strokeLinecap="round" pointerEvents="none" />
            )}
            <line
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="transparent" strokeWidth={18} style={{ cursor: afford ? 'pointer' : 'not-allowed' }}
              onClick={() => afford && onBuild(target.action)}
            />
            {hovered && <BuildChip cx={mx} cy={my} cost={target.cost} hand={myHand} afford={afford} onConfirm={() => afford && onBuild(target.action)} />}
          </g>
        );
      })}

      {/* Vertices (vilas/cidades + alvos validos + fantasma + confirmacao) */}
      {board.vertexOrder.map((vid) => {
        const v = board.vertices[vid]!;
        const b = buildings[vid];
        const target = vertexTarget(state, mode, vid, me);
        const hovered = hoverV === vid;
        const afford = target ? affords(myHand, target.cost) : false;
        return (
          <g key={vid}
            onMouseEnter={() => { if (target) { setHoverV(vid); setHoverE(null); } }}
            onMouseLeave={() => setHoverV((c) => (c === vid ? null : c))}>
            {b && <BuildingGlyph x={v.x} y={v.y} kind={b.kind} fill={PLAYER_FILL[b.owner]} />}
            {target && hovered && (
              <g opacity={afford ? 0.6 : 0.3} pointerEvents="none">
                <BuildingGlyph x={v.x} y={v.y} kind={target.kind === 'city' ? 'city' : 'settlement'} fill={PLAYER_FILL[me]} />
              </g>
            )}
            {target && !hovered && <circle cx={v.x} cy={v.y} r={7} fill="#ffffff" fillOpacity={0.7} stroke="#4da3ff" pointerEvents="none" />}
            {target && (
              <circle
                cx={v.x} cy={v.y} r={13} fill="transparent" style={{ cursor: afford ? 'pointer' : 'not-allowed' }}
                onClick={() => afford && onBuild(target.action)}
              />
            )}
            {target && hovered && <BuildChip cx={v.x} cy={v.y - 8} cost={target.cost} hand={myHand} afford={afford} onConfirm={() => afford && onBuild(target.action)} />}
          </g>
        );
      })}

      {/* Dica do melhor spot (setup): anel pulsante + seta saltitante */}
      {hintVertex && board.vertices[hintVertex] && !buildings[hintVertex] && (
        <SpotHint x={board.vertices[hintVertex]!.x} y={board.vertices[hintVertex]!.y} />
      )}
    </svg>
  );
}

/**
 * Chip de confirmacao de construcao: mostra o custo (cada recurso ESCURECE se o
 * jogador nao tem) e um botao ✓ (verde se da pra pagar, cinza se nao). Uma "ponte"
 * invisivel liga o chip ao spot para o hover nao cair no caminho.
 */
function BuildChip({
  cx, cy, cost, hand, afford, onConfirm,
}: {
  cx: number; cy: number; cost: Cost; hand: Record<Resource, number> | undefined; afford: boolean; onConfirm: () => void;
}) {
  const items = (Object.entries(cost) as [Resource, number][]).filter(([, n]) => n > 0);
  const iconW = 20;
  const W = Math.max(items.length * iconW + 30, 36);
  const top = cy - 50;
  const left = cx - W / 2;
  const checkCx = left + W - 15;
  return (
    <g filter="url(#softShadow)">
      {/* ponte invisivel (mantem o hover continuo entre o spot e o chip) */}
      <rect x={cx - 14} y={top} width={28} height={cy - top + 6} fill="transparent" />
      <rect x={left} y={top} width={W} height={26} rx={9} fill="#fdfbf6" stroke="#caa24a" strokeWidth={1.5} />
      {items.map(([r, n], i) => (
        <g key={r} opacity={(hand?.[r] ?? 0) >= n ? 1 : 0.25}>
          <text x={left + 12 + i * iconW} y={top + 18} fontSize={14} textAnchor="middle">{RESOURCE_ICON[r]}</text>
          {n > 1 && <text x={left + 12 + i * iconW + 8} y={top + 20} fontSize={9} fontWeight={700} fill="#3a2f22">{n}</text>}
        </g>
      ))}
      <g style={{ cursor: afford ? 'pointer' : 'not-allowed' }} onClick={onConfirm}>
        <circle cx={checkCx} cy={top + 13} r={11} fill={afford ? '#2e9e57' : '#c2c2c2'} />
        <path d={`M ${checkCx - 5} ${top + 13} l 3.2 4 l 6 -8`} fill="none" stroke="#fff" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
}

function starPath(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    d += `${i === 0 ? 'M' : 'L'}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
}

function SpotHint({ x, y }: { x: number; y: number }) {
  return (
    <g pointerEvents="none" className="spot-hint">
      <circle cx={x} cy={y} r={11} fill="none" stroke="#e8b53a" strokeWidth={3} className="spot-ring" />
      <g className="spot-arrow" filter="url(#softShadow)">
        <path d={starPath(x, y - 26, 9.5, 4)} fill="#e8b53a" stroke="#ffffff" strokeWidth={1.6} strokeLinejoin="round" />
      </g>
    </g>
  );
}

/** Barquinho ancorado num porto: vela larga com o icone do recurso bem visivel e a taxa no casco. */
function PortBoat({ x, y, type }: { x: number; y: number; type: 'generic' | Resource }) {
  const rate = type === 'generic' ? '3:1' : '2:1';
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none" filter="url(#softShadow)">
      {/* casco */}
      <path d="M -20 1 Q -22 14 -10 14 L 10 14 Q 22 14 20 1 Z" fill="#9a6a3a" stroke="#5d3a1d" strokeWidth={1.4} />
      <path d="M -20 1 L 20 1" stroke="#c79a63" strokeWidth={2.8} strokeLinecap="round" />
      {/* mastro */}
      <line x1={-1.5} y1={1} x2={-1.5} y2={-23} stroke="#5d3a1d" strokeWidth={1.8} strokeLinecap="round" />
      {/* vela larga (mostra bem o icone / a taxa generica) */}
      <path d="M 1 -22 Q 19 -16 19 -10 Q 19 -4 1 -2 Z" fill="#fbf7ee" stroke="#cbb68f" strokeWidth={1} />
      {type === 'generic' ? (
        <text x={9.5} y={-8.5} textAnchor="middle" fontSize={11} fontWeight={800} fill="#3a2f22" fontFamily="Georgia, serif">3:1</text>
      ) : (
        <>
          <text x={9.5} y={-7.5} textAnchor="middle" fontSize={15}>{RESOURCE_ICON[type]}</text>
          <text x={0} y={11.5} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff4e0" fontFamily="Georgia, serif">{rate}</text>
        </>
      )}
    </g>
  );
}

function NumberToken({ cx, cy, n }: { cx: number; cy: number; n: number }) {
  const hot = n === 6 || n === 8;
  const count = 6 - Math.abs(7 - n);
  const gap = 3.2;
  const start = cx - ((count - 1) * gap) / 2;
  return (
    <g pointerEvents="none" filter="url(#softShadow)">
      <rect x={cx - 16} y={cy - 16} width={32} height={32} rx={8} fill="url(#tokenGrad)" stroke="#b79b63" strokeWidth={1} />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={17} fontWeight={800} fill={hot ? '#c0392b' : '#2a2a2a'} fontFamily="Georgia, serif">
        {n}
      </text>
      <g>
        {Array.from({ length: count }, (_, i) => (
          <circle key={i} cx={start + i * gap} cy={cy + 11} r={1.3} fill={hot ? '#c0392b' : '#2a2a2a'} />
        ))}
      </g>
    </g>
  );
}

function Blocker({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g pointerEvents="none" filter="url(#softShadow)">
      <ellipse cx={cx} cy={cy + 9} rx={9} ry={3} fill="#000" opacity={0.3} />
      <path d={`M ${cx - 7} ${cy + 8} Q ${cx - 8} ${cy - 6} ${cx} ${cy - 8} Q ${cx + 8} ${cy - 6} ${cx + 7} ${cy + 8} Z`} fill="#2b2b2b" stroke="#111" />
      <circle cx={cx} cy={cy - 8} r={5} fill="#2b2b2b" stroke="#111" />
    </g>
  );
}

/** Motivos vetoriais por terreno (maiores, atras do token). */
function TerrainMotif({ terrain, cx, cy }: { terrain: Terrain; cx: number; cy: number }) {
  const y = cy - 14;
  switch (terrain) {
    case 'forest':
      return (
        <g pointerEvents="none" opacity={0.95}>
          <Tree x={cx - 24} y={y + 6} s={1.05} />
          <Tree x={cx + 24} y={y + 8} s={0.95} />
          <Tree x={cx - 9} y={y - 6} s={1.35} />
          <Tree x={cx + 12} y={y - 4} s={1.2} />
        </g>
      );
    case 'pasture':
      return (
        <g pointerEvents="none">
          <Sheep x={cx - 11} y={y - 2} s={1.05} />
          <Sheep x={cx + 13} y={y + 5} s={0.85} />
          <Tuft x={cx - 24} y={y + 12} c="#6fa235" />
          <Tuft x={cx + 25} y={y + 10} c="#6fa235" />
          <Tuft x={cx + 2} y={y + 14} c="#6fa235" />
        </g>
      );
    case 'field':
      return (
        <g pointerEvents="none" opacity={0.92} stroke="#b9851a" strokeWidth={2} strokeLinecap="round">
          {[-22, -13, -4, 5, 14, 23].map((dx) => (
            <g key={dx}>
              <line x1={cx + dx} y1={y + 14} x2={cx + dx} y2={y - 12} />
              <line x1={cx + dx} y1={y - 9} x2={cx + dx - 4} y2={y - 13} />
              <line x1={cx + dx} y1={y - 9} x2={cx + dx + 4} y2={y - 13} />
              <line x1={cx + dx} y1={y - 3} x2={cx + dx - 4} y2={y - 7} />
              <line x1={cx + dx} y1={y - 3} x2={cx + dx + 4} y2={y - 7} />
              <line x1={cx + dx} y1={y + 3} x2={cx + dx - 4} y2={y - 1} />
              <line x1={cx + dx} y1={y + 3} x2={cx + dx + 4} y2={y - 1} />
            </g>
          ))}
        </g>
      );
    case 'hills':
      return (
        <g pointerEvents="none" opacity={0.92}>
          {[
            [cx - 16, y - 6], [cx - 4, y - 6], [cx + 8, y - 6],
            [cx - 10, y + 2], [cx + 2, y + 2],
            [cx - 16, y + 10], [cx - 4, y + 10], [cx + 8, y + 10],
          ].map(([bx, by], i) => (
            <rect key={i} x={bx} y={by} width={11} height={6} rx={1.2} fill="#d8763f" stroke="#7c3417" strokeWidth={1.1} />
          ))}
        </g>
      );
    case 'mountain':
      return (
        <g pointerEvents="none" opacity={0.95}>
          <polygon points={`${cx - 24},${y + 12} ${cx - 8},${y - 12} ${cx + 8},${y + 12}`} fill="#6b7480" stroke="#4c545e" strokeWidth={1} />
          <polygon points={`${cx - 2},${y + 12} ${cx + 12},${y - 6} ${cx + 26},${y + 12}`} fill="#7c8593" stroke="#4c545e" strokeWidth={1} />
          <polygon points={`${cx - 8},${y - 12} ${cx - 3},${y - 5} ${cx - 13},${y - 5}`} fill="#eef1f4" opacity={0.85} />
          <polygon points={`${cx + 12},${y - 6} ${cx + 16},${y} ${cx + 8},${y}`} fill="#eef1f4" opacity={0.7} />
        </g>
      );
    case 'desert':
      return (
        <g pointerEvents="none">
          <path d={`M ${cx} ${y + 16} L ${cx} ${y - 12} M ${cx} ${y - 4} L ${cx - 9} ${y - 9} L ${cx - 9} ${y - 16} M ${cx} ${y + 1} L ${cx + 9} ${y - 4} L ${cx + 9} ${y - 11}`}
            stroke="#5b8f4a" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>
      );
    default:
      return null;
  }
}

function Tree({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-1.8} y={5} width={3.6} height={6} fill="#5b3a1e" />
      <polygon points="0,-12 8,4 -8,4" fill="#1f6336" />
      <polygon points="0,-6 7,8 -7,8" fill="#2a7a44" />
    </g>
  );
}

function Sheep({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={0} cy={0} rx={11} ry={8} fill="#f4f4f0" stroke="#cbcbc3" strokeWidth={0.9} />
      <circle cx={8} cy={-2} r={4} fill="#454545" />
      <rect x={4} y={6} width={1.8} height={3.5} fill="#454545" />
      <rect x={10} y={6} width={1.8} height={3.5} fill="#454545" />
    </g>
  );
}

function Tuft({ x, y, c }: { x: number; y: number; c: string }) {
  return (
    <path d={`M ${x} ${y} l -2.5 -6 M ${x} ${y} l 0 -7 M ${x} ${y} l 2.5 -6`} stroke={c} strokeWidth={1.8} strokeLinecap="round" fill="none" />
  );
}

function BuildingGlyph({ x, y, kind, fill }: { x: number; y: number; kind: 'settlement' | 'city'; fill: string }) {
  const dark = '#0c1118';
  if (kind === 'city') {
    // Cidade: torre central com ameias entre duas alas mais baixas (maior que a vila).
    return (
      <g pointerEvents="none" className="piece-enter" filter="url(#softShadow)">
        {/* alas laterais */}
        <rect x={x - 15} y={y} width={11} height={12} rx={1.5} fill={fill} stroke={dark} strokeWidth={1.4} />
        <rect x={x + 4} y={y} width={11} height={12} rx={1.5} fill={fill} stroke={dark} strokeWidth={1.4} />
        {/* sombra das alas */}
        <rect x={x - 15} y={y} width={11} height={12} rx={1.5} fill="#000" opacity={0.12} />
        <rect x={x + 4} y={y} width={11} height={12} rx={1.5} fill="#000" opacity={0.12} />
        {/* torre central */}
        <rect x={x - 6} y={y - 13} width={12} height={25} rx={1.5} fill={fill} stroke={dark} strokeWidth={1.5} />
        {/* ameias (merloes) */}
        <rect x={x - 6} y={y - 16} width={3.4} height={4} fill={fill} stroke={dark} strokeWidth={1.2} />
        <rect x={x - 1.7} y={y - 16} width={3.4} height={4} fill={fill} stroke={dark} strokeWidth={1.2} />
        <rect x={x + 2.6} y={y - 16} width={3.4} height={4} fill={fill} stroke={dark} strokeWidth={1.2} />
        {/* janelas e porta */}
        <rect x={x - 2.4} y={y - 9} width={4.8} height={5} rx={1} fill={dark} opacity={0.55} />
        <rect x={x - 2.4} y={y + 2} width={4.8} height={10} rx={1} fill={dark} opacity={0.62} />
      </g>
    );
  }
  // Vila: casinha com telhado e porta (um pouco maior que o modelo antigo).
  return (
    <g pointerEvents="none" className="piece-enter" filter="url(#softShadow)">
      {/* paredes */}
      <rect x={x - 10} y={y - 1} width={20} height={11} rx={1.5} fill={fill} stroke={dark} strokeWidth={1.5} />
      {/* telhado */}
      <polygon points={`${x - 12},${y} ${x},${y - 13} ${x + 12},${y}`} fill={fill} stroke={dark} strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points={`${x - 12},${y} ${x},${y - 13} ${x + 12},${y}`} fill="#000" opacity={0.16} />
      {/* porta */}
      <rect x={x - 2.6} y={y + 2} width={5.2} height={8} rx={1} fill={dark} opacity={0.55} />
    </g>
  );
}
