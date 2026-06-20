import { useMemo, useState } from 'react';
import {
  distanceRuleOk,
  roadConnects,
  vertexTouchesPlayerRoad,
  type GameState,
  type PlayerColor,
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
  onVertex: (vertexId: string) => void;
  onEdge: (edgeId: string) => void;
  onHex: (hexId: string) => void;
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

export function Board({ state, mode, onVertex, onEdge, onHex }: BoardProps) {
  const { board, buildings, roads, blocker } = state;
  const me = state.currentPlayer;
  const hexMode = mode === 'moveBlocker';
  const [hoverV, setHoverV] = useState<string | null>(null);
  const [hoverE, setHoverE] = useState<string | null>(null);

  const viewBox = useMemo(() => {
    const xs = board.vertexOrder.map((v) => board.vertices[v]!.x);
    const ys = board.vertexOrder.map((v) => board.vertices[v]!.y);
    const pad = 64;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - minX + pad;
    const h = Math.max(...ys) - minY + pad;
    return `${minX} ${minY} ${w} ${h}`;
  }, [board]);

  const ghostCity = mode === 'buildCity';

  return (
    <svg viewBox={viewBox} role="img" aria-label="Tabuleiro hexagonal">
      {/* Portos (linhas ate os vertices + etiqueta) */}
      {board.ports.map((port) => {
        const a = board.vertices[port.vertices[0]]!;
        const b = board.vertices[port.vertices[1]]!;
        const lx = port.x + port.nx * 34;
        const ly = port.y + port.ny * 34;
        const label = port.type === 'generic' ? '3:1' : `${RESOURCE_ICON[port.type]}2:1`;
        return (
          <g key={port.id} pointerEvents="none">
            <line x1={a.x} y1={a.y} x2={lx} y2={ly} stroke="#5b6b80" strokeWidth={2} strokeDasharray="3 4" />
            <line x1={b.x} y1={b.y} x2={lx} y2={ly} stroke="#5b6b80" strokeWidth={2} strokeDasharray="3 4" />
            <rect x={lx - 20} y={ly - 12} width={40} height={24} rx={6} fill="#10202f" stroke="#5b6b80" />
            <text x={lx} y={ly + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#cde">
              {label}
            </text>
          </g>
        );
      })}

      {/* Hexes */}
      {board.hexOrder.map((hid) => {
        const hex = board.hexes[hid]!;
        const pts = hex.corners.map((vid) => board.vertices[vid]!).map((v) => `${v.x},${v.y}`).join(' ');
        const isBlocked = blocker.hexId === hid;
        return (
          <g key={hid}>
            <polygon
              points={pts}
              fill={TERRAIN_FILL[hex.terrain]}
              stroke={hexMode ? '#4da3ff' : '#0c1118'}
              strokeWidth={hexMode ? 3 : 2}
              style={{ cursor: hexMode ? 'pointer' : 'default' }}
              onClick={() => hexMode && onHex(hid)}
            />
            {hex.number !== null && (
              <g pointerEvents="none">
                <circle cx={hex.cx} cy={hex.cy} r={16} fill="#f3ead0" stroke="#0c1118" />
                <text
                  x={hex.cx}
                  y={hex.cy + 5}
                  textAnchor="middle"
                  fontSize={16}
                  fontWeight={700}
                  fill={hex.number === 6 || hex.number === 8 ? '#c0392b' : '#1a1a1a'}
                >
                  {hex.number}
                </text>
              </g>
            )}
            {isBlocked && (
              <text x={hex.cx} y={hex.cy - 22} textAnchor="middle" fontSize={26} pointerEvents="none">
                ⬣
              </text>
            )}
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
            <line key={eid} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PLAYER_FILL[road.owner]} strokeWidth={9} strokeLinecap="round" />
          );
        }
        if (!edgeValid(state, mode, eid, me)) return null;
        const hovered = hoverE === eid;
        return (
          <g key={eid}>
            {hovered ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PLAYER_FILL[me]} strokeOpacity={0.6} strokeWidth={9} strokeLinecap="round" pointerEvents="none" />
            ) : (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#4da3ff" strokeOpacity={0.45} strokeWidth={6} strokeDasharray="2 7" strokeLinecap="round" pointerEvents="none" />
            )}
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="transparent"
              strokeWidth={18}
              style={{ cursor: 'pointer' }}
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
            {valid && !hovered && (
              <circle cx={v.x} cy={v.y} r={7} fill="#4da3ff" fillOpacity={0.55} pointerEvents="none" />
            )}
            {valid && (
              <circle
                cx={v.x}
                cy={v.y}
                r={13}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={() => onVertex(vid)}
                onMouseEnter={() => setHoverV(vid)}
                onMouseLeave={() => setHoverV((c) => (c === vid ? null : c))}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function BuildingGlyph({
  x,
  y,
  kind,
  fill,
}: {
  x: number;
  y: number;
  kind: 'settlement' | 'city';
  fill: string;
}) {
  if (kind === 'city') {
    return (
      <g pointerEvents="none">
        <rect x={x - 11} y={y - 4} width={22} height={14} rx={2} fill={fill} stroke="#0c1118" strokeWidth={1.5} />
        <polygon points={`${x - 11},${y - 4} ${x},${y - 13} ${x + 11},${y - 4}`} fill={fill} stroke="#0c1118" strokeWidth={1.5} />
        <rect x={x - 3} y={y + 1} width={6} height={9} fill="#0c1118" opacity={0.55} />
      </g>
    );
  }
  return (
    <g pointerEvents="none">
      <polygon points={`${x - 8},${y + 7} ${x - 8},${y - 2} ${x},${y - 9} ${x + 8},${y - 2} ${x + 8},${y + 7}`} fill={fill} stroke="#0c1118" strokeWidth={1.5} />
    </g>
  );
}
