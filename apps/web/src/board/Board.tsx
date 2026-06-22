import { useMemo, useState } from 'react';
import {
  distanceRuleOk,
  roadConnects,
  vertexTouchesPlayerRoad,
  type GameState,
  type PlayerColor,
  type Terrain,
} from '@hexgame/engine';
import { PLAYER_FILL, RESOURCE_ICON, TERRAIN_FILL } from '../game/theme.js';

export type InteractionMode =
  | 'idle'
  | 'placeSettlement'
  | 'placeRoad'
  | 'buildRoad'
  | 'buildSettlement'
  | 'buildCity'
  | 'moveBlocker';

interface BoardProps {
  state: GameState;
  mode: InteractionMode;
  /** Vertice sugerido (melhor spot) para destacar no setup. */
  hintVertex?: string | null;
  onVertex: (vertexId: string) => void;
  onEdge: (edgeId: string) => void;
  onHex: (hexId: string) => void;
}

interface Pt {
  x: number;
  y: number;
}

function vertexValid(state: GameState, mode: InteractionMode, vid: string, me: PlayerColor): boolean {
  switch (mode) {
    case 'placeSettlement':
      return distanceRuleOk(state, vid);
    case 'buildSettlement':
      return distanceRuleOk(state, vid) && vertexTouchesPlayerRoad(state, me, vid);
    case 'buildCity': {
      const b = state.buildings[vid];
      return !!b && b.owner === me && b.kind === 'settlement';
    }
    default:
      return false;
  }
}

function edgeValid(state: GameState, mode: InteractionMode, eid: string, me: PlayerColor): boolean {
  if (state.roads[eid]) return false;
  if (mode === 'placeRoad') {
    return !!state.setupLastVertex && state.board.edges[eid]!.v.includes(state.setupLastVertex);
  }
  if (mode === 'buildRoad') return roadConnects(state, me, eid);
  return false;
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

export function Board({ state, mode, hintVertex, onVertex, onEdge, onHex }: BoardProps) {
  const { board, buildings, roads, blocker } = state;
  const me = state.currentPlayer;
  const hexMode = mode === 'moveBlocker';
  const ghostCity = mode === 'buildCity';
  const [hoverV, setHoverV] = useState<string | null>(null);
  const [hoverE, setHoverE] = useState<string | null>(null);

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

      {/* Agua: halo amplo + orla mais brilhante */}
      <g filter="url(#waterBlur)" opacity={0.55}>
        {board.hexOrder.map((hid) => {
          const h = board.hexes[hid]!;
          return <path key={hid} d={roundedPath(scaled(cornersOf[hid]!, h.cx, h.cy, 1.62), 20)} fill="#3aa9e6" />;
        })}
      </g>
      <g filter="url(#waterBlur)" opacity={0.9}>
        {board.hexOrder.map((hid) => {
          const h = board.hexes[hid]!;
          return <path key={hid} d={roundedPath(scaled(cornersOf[hid]!, h.cx, h.cy, 1.32), 20)} fill="#6fd0f5" />;
        })}
      </g>
      {/* Litoral (areia) com leve mottle */}
      <g>
        {board.hexOrder.map((hid) => {
          const h = board.hexes[hid]!;
          return <path key={hid} d={roundedPath(scaled(cornersOf[hid]!, h.cx, h.cy, 1.16), 22)} fill="url(#coastGrad)" />;
        })}
      </g>

      {/* Portos */}
      {board.ports.map((port) => {
        const a = board.vertices[port.vertices[0]]!;
        const b = board.vertices[port.vertices[1]]!;
        const lx = port.x + port.nx * 30;
        const ly = port.y + port.ny * 30;
        const label = port.type === 'generic' ? '3:1' : `${RESOURCE_ICON[port.type]}2:1`;
        return (
          <g key={port.id} pointerEvents="none">
            <line x1={a.x} y1={a.y} x2={lx} y2={ly} stroke="#9c7b46" strokeWidth={2.5} strokeLinecap="round" />
            <line x1={b.x} y1={b.y} x2={lx} y2={ly} stroke="#9c7b46" strokeWidth={2.5} strokeLinecap="round" />
            <rect x={lx - 19} y={ly - 11} width={38} height={22} rx={7} fill="#3a2f22" stroke="#b9935a" filter="url(#softShadow)" />
            <text x={lx} y={ly + 5} textAnchor="middle" fontSize={12} fontWeight={700} fill="#f3e6cd">{label}</text>
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
            <path
              d={path}
              fill="transparent"
              stroke={hexMode ? '#ffe08a' : 'rgba(0,0,0,0.38)'}
              strokeWidth={hexMode ? 4 : 2}
              strokeLinejoin="round"
              style={{ cursor: hexMode ? 'pointer' : 'default' }}
              onClick={() => hexMode && onHex(hid)}
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
        if (!edgeValid(state, mode, eid, me)) return null;
        const hovered = hoverE === eid;
        return (
          <g key={eid}>
            {hovered ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PLAYER_FILL[me]} strokeOpacity={0.7} strokeWidth={9} strokeLinecap="round" pointerEvents="none" />
            ) : (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={6} strokeDasharray="2 7" strokeLinecap="round" pointerEvents="none" />
            )}
            <line
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="transparent" strokeWidth={18} style={{ cursor: 'pointer' }}
              onClick={() => onEdge(eid)}
              onMouseEnter={() => setHoverE(eid)}
              onMouseLeave={() => setHoverE((c) => (c === eid ? null : c))}
            />
          </g>
        );
      })}

      {/* Vertices (vilas/cidades + alvos validos + fantasma) */}
      {board.vertexOrder.map((vid) => {
        const v = board.vertices[vid]!;
        const b = buildings[vid];
        const valid = vertexValid(state, mode, vid, me);
        const hovered = hoverV === vid;
        return (
          <g key={vid}>
            {b && <BuildingGlyph x={v.x} y={v.y} kind={b.kind} fill={PLAYER_FILL[b.owner]} />}
            {valid && hovered && (
              <g opacity={0.55} pointerEvents="none">
                <BuildingGlyph x={v.x} y={v.y} kind={ghostCity ? 'city' : 'settlement'} fill={PLAYER_FILL[me]} />
              </g>
            )}
            {valid && !hovered && <circle cx={v.x} cy={v.y} r={7} fill="#ffffff" fillOpacity={0.7} stroke="#4da3ff" pointerEvents="none" />}
            {valid && (
              <circle
                cx={v.x} cy={v.y} r={13} fill="transparent" style={{ cursor: 'pointer' }}
                onClick={() => onVertex(vid)}
                onMouseEnter={() => setHoverV(vid)}
                onMouseLeave={() => setHoverV((c) => (c === vid ? null : c))}
              />
            )}
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
