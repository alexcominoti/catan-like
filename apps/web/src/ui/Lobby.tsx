import { useState } from 'react';
import {
  PLAYER_COLORS,
  type DesertPlacement,
  type NumberLayout,
  type PlayerColor,
} from '@hexgame/engine';
import type { Difficulty } from '@hexgame/bot';
import { PLAYER_FILL, PLAYER_LABEL } from '../game/theme.js';

export type SeatKind = 'human' | 'bot';

export interface GameConfig {
  players: { color: PlayerColor; name: string }[];
  bots: PlayerColor[];
  botDifficulty: Record<PlayerColor, Difficulty>;
  seed: number;
  numberLayout: NumberLayout;
  desert: DesertPlacement;
  pointsToWin: number;
  discardLimit: number;
}

const DEFAULT_NAMES = ['Você', 'Bot 2', 'Bot 3', 'Bot 4'];
const DEFAULT_KINDS: SeatKind[] = ['human', 'bot', 'bot', 'bot'];
const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };

export function Lobby({ onStart }: { onStart: (cfg: GameConfig) => void }) {
  const [count, setCount] = useState(4);
  const [names, setNames] = useState<string[]>([...DEFAULT_NAMES]);
  const [colors, setColors] = useState<PlayerColor[]>([...PLAYER_COLORS]);
  const [kinds, setKinds] = useState<SeatKind[]>([...DEFAULT_KINDS]);
  const [diffs, setDiffs] = useState<Difficulty[]>(['medium', 'medium', 'medium', 'medium']);
  const [numberLayout, setNumberLayout] = useState<NumberLayout>('balanced');
  const [desert, setDesert] = useState<DesertPlacement>('random');
  const [pointsToWin, setPointsToWin] = useState(10);
  const [discardLimit, setDiscardLimit] = useState(7);
  const [seedText, setSeedText] = useState('');

  function setColor(slot: number, color: PlayerColor) {
    setColors((prev) => {
      const next = [...prev];
      const other = next.indexOf(color);
      if (other >= 0) next[other] = next[slot]!;
      next[slot] = color;
      return next;
    });
  }

  function start() {
    const seed = seedText.trim() === '' ? Math.floor(Math.random() * 0x7fffffff) : hashSeed(seedText.trim());
    const players = Array.from({ length: count }, (_, i) => ({
      color: colors[i]!,
      name: names[i]!.trim() || DEFAULT_NAMES[i]!,
    }));
    const bots: PlayerColor[] = [];
    const botDifficulty: Record<string, Difficulty> = {};
    players.forEach((p, i) => {
      if (kinds[i] === 'bot') {
        bots.push(p.color);
        botDifficulty[p.color] = diffs[i]!;
      }
    });
    onStart({
      players,
      bots,
      botDifficulty: botDifficulty as Record<PlayerColor, Difficulty>,
      seed,
      numberLayout,
      desert,
      pointsToWin,
      discardLimit,
    });
  }

  return (
    <div className="lobby">
      <div className="lobby-shell">
        <aside className="lobby-players">
          <h2>Jogadores ({count}/4)</h2>
          <div className="seg full">
            {[3, 4].map((n) => (
              <button key={n} className={count === n ? 'active' : ''} onClick={() => setCount(n)}>{n} jogadores</button>
            ))}
          </div>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="seat" style={{ borderLeftColor: PLAYER_FILL[colors[i]!] }}>
              <div className="seat-top">
                <input
                  value={names[i]}
                  maxLength={16}
                  onChange={(e) => setNames((p) => { const n = [...p]; n[i] = e.target.value; return n; })}
                />
                <div className="seg small">
                  {(['human', 'bot'] as SeatKind[]).map((k) => (
                    <button key={k} className={kinds[i] === k ? 'active' : ''} onClick={() => setKinds((p) => { const n = [...p]; n[i] = k; return n; })}>
                      {k === 'human' ? '🙂' : '🤖'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="seat-bottom">
                <div className="color-pick">
                  {PLAYER_COLORS.map((c) => (
                    <button key={c} title={PLAYER_LABEL[c]} className={`color-dot${colors[i] === c ? ' active' : ''}`}
                      style={{ background: PLAYER_FILL[c] }} onClick={() => setColor(i, c)} />
                  ))}
                </div>
                {kinds[i] === 'bot' && (
                  <div className="seg tiny">
                    {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                      <button key={d} className={diffs[i] === d ? 'active' : ''} onClick={() => setDiffs((p) => { const n = [...p]; n[i] = d; return n; })}>
                        {DIFF_LABEL[d]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </aside>

        <main className="lobby-main">
          <h1>⬡ HexGame</h1>
          <p className="lobby-sub">Colonização hexagonal · jogo base · mesma tela (hotseat)</p>

          <section className="lobby-section">
            <h3>Tabuleiro</h3>
            <div className="tile-row">
              <Tile icon="🎲" label="Números equilibrados" hint="6 e 8 nunca vizinhos"
                active={numberLayout === 'balanced'} onClick={() => setNumberLayout((v) => (v === 'balanced' ? 'random' : 'balanced'))} />
              <Tile icon="🌵" label="Deserto no centro" hint="ladrão começa no meio"
                active={desert === 'center'} onClick={() => setDesert((v) => (v === 'center' ? 'random' : 'center'))} />
            </div>
          </section>

          <section className="lobby-section">
            <h3>Configurações avançadas</h3>
            <div className="slider-row">
              <label>Pontos para vencer <b>{pointsToWin}</b></label>
              <input type="range" min={3} max={15} value={pointsToWin} onChange={(e) => setPointsToWin(+e.target.value)} />
            </div>
            <div className="slider-row">
              <label>Limite de cartas (descarte no 7) <b>{discardLimit}</b></label>
              <input type="range" min={5} max={15} value={discardLimit} onChange={(e) => setDiscardLimit(+e.target.value)} />
            </div>
            <div className="slider-row">
              <label>Seed (opcional)</label>
              <div className="seed-row">
                <input value={seedText} placeholder="aleatória" onChange={(e) => setSeedText(e.target.value)} />
                <button onClick={() => setSeedText('')}>🎲 Aleatória</button>
              </div>
            </div>
          </section>

          <button className="lobby-start" onClick={start}>Começar partida</button>
        </main>
      </div>
    </div>
  );
}

function Tile({ icon, label, hint, active, onClick }: { icon: string; label: string; hint: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`tile${active ? ' active' : ''}`} onClick={onClick}>
      <span className="tile-icon">{icon}</span>
      <span className="tile-label">{label}</span>
      <span className="tile-hint">{hint}</span>
    </button>
  );
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
