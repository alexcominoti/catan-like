import { useState } from 'react';
import { PLAYER_COLORS, type DesertPlacement, type NumberLayout, type PlayerColor } from '@hexgame/engine';
import type { Difficulty } from '@hexgame/bot';
import type { ReactNode } from 'react';
import { Users, Smile, Bot, Dices, Target, Play, ArrowLeft, Shuffle } from 'lucide-react';
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

export function Lobby({ onStart, onBack }: { onStart: (cfg: GameConfig) => void; onBack?: () => void }) {
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
      players, bots, botDifficulty: botDifficulty as Record<PlayerColor, Difficulty>,
      seed, numberLayout, desert, pointsToWin, discardLimit,
    });
  }

  return (
    <div className="page setup-page">
      <div className="page-head">
        <div>
          {onBack && <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Voltar ao lobby</button>}
          <span className="eyebrow">CRIAR SALA</span>
          <h1>Monte sua mesa.</h1>
        </div>
      </div>

      <div className="setup-grid">
        <div className="card su-players">
          <h2 className="su-h"><Users size={18} className="ic-primary" /> Jogadores ({count}/4)</h2>
          <div className="su-seg full">
            {[3, 4].map((n) => (
              <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>{n} jogadores</button>
            ))}
          </div>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="su-seat" style={{ borderLeftColor: PLAYER_FILL[colors[i]!] }}>
              <div className="su-seat-top">
                <input value={names[i]} maxLength={16}
                  onChange={(e) => setNames((p) => { const n = [...p]; n[i] = e.target.value; return n; })} />
                <div className="su-seg sm">
                  <button className={kinds[i] === 'human' ? 'on' : ''} title="Humano"
                    onClick={() => setKinds((p) => { const n = [...p]; n[i] = 'human'; return n; })}><Smile size={15} /></button>
                  <button className={kinds[i] === 'bot' ? 'on' : ''} title="Bot"
                    onClick={() => setKinds((p) => { const n = [...p]; n[i] = 'bot'; return n; })}><Bot size={15} /></button>
                </div>
              </div>
              <div className="su-seat-bottom">
                <div className="su-colors">
                  {PLAYER_COLORS.map((c) => (
                    <button key={c} title={PLAYER_LABEL[c]} className={`su-dot${colors[i] === c ? ' on' : ''}`}
                      style={{ background: PLAYER_FILL[c] }} onClick={() => setColor(i, c)} />
                  ))}
                </div>
                {kinds[i] === 'bot' && (
                  <div className="su-seg xs">
                    {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                      <button key={d} className={diffs[i] === d ? 'on' : ''}
                        onClick={() => setDiffs((p) => { const n = [...p]; n[i] = d; return n; })}>{DIFF_LABEL[d]}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="card su-settings">
          <h3 className="su-sub">Tabuleiro</h3>
          <div className="su-tiles">
            <SetupTile icon={<Dices size={20} />} label="Números equilibrados" hint="6 e 8 nunca vizinhos"
              active={numberLayout === 'balanced'} onClick={() => setNumberLayout((v) => (v === 'balanced' ? 'random' : 'balanced'))} />
            <SetupTile icon={<Target size={20} />} label="Deserto no centro" hint="ladrão começa no meio"
              active={desert === 'center'} onClick={() => setDesert((v) => (v === 'center' ? 'random' : 'center'))} />
          </div>

          <h3 className="su-sub">Configurações avançadas</h3>
          <div className="su-slider">
            <label>Pontos para vencer <b>{pointsToWin}</b></label>
            <input type="range" min={3} max={15} value={pointsToWin} onChange={(e) => setPointsToWin(+e.target.value)} />
          </div>
          <div className="su-slider">
            <label>Limite de cartas (descarte no 7) <b>{discardLimit}</b></label>
            <input type="range" min={5} max={15} value={discardLimit} onChange={(e) => setDiscardLimit(+e.target.value)} />
          </div>
          <div className="su-slider">
            <label>Seed (opcional)</label>
            <div className="su-seed">
              <input value={seedText} placeholder="aleatória" onChange={(e) => setSeedText(e.target.value)} />
              <button onClick={() => setSeedText('')}><Shuffle size={14} /> Aleatória</button>
            </div>
          </div>

          <button className="cta big su-start" onClick={start}><Play size={16} /> Começar partida</button>
        </div>
      </div>
    </div>
  );
}

function SetupTile({ icon, label, hint, active, onClick }: { icon: ReactNode; label: string; hint: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`su-tile${active ? ' active' : ''}`} onClick={onClick}>
      <span className="su-tile-icon">{icon}</span>
      <span className="su-tile-label">{label}</span>
      <span className="su-tile-hint">{hint}</span>
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
