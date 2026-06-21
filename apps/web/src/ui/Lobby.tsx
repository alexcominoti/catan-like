import { useState } from 'react';
import { PLAYER_COLORS, type PlayerColor } from '@hexgame/engine';
import { PLAYER_FILL, PLAYER_LABEL } from '../game/theme.js';

export interface GameConfig {
  players: { color: PlayerColor; name: string }[];
  seed: number;
}

const DEFAULT_NAMES = ['Jogador 1', 'Jogador 2', 'Jogador 3', 'Jogador 4'];

export function Lobby({ onStart }: { onStart: (cfg: GameConfig) => void }) {
  const [count, setCount] = useState(4);
  const [names, setNames] = useState<string[]>([...DEFAULT_NAMES]);
  const [colors, setColors] = useState<PlayerColor[]>([...PLAYER_COLORS]);
  const [seedText, setSeedText] = useState('');

  function setColor(slot: number, color: PlayerColor) {
    setColors((prev) => {
      const next = [...prev];
      const other = next.indexOf(color);
      if (other >= 0) next[other] = next[slot]!; // troca para manter unicidade
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
    onStart({ players, seed });
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>⬡ HexGame</h1>
        <p className="lobby-sub">Colonização hexagonal · jogo base · mesma tela (hotseat)</p>

        <div className="lobby-field">
          <label>Jogadores</label>
          <div className="seg">
            {[3, 4].map((n) => (
              <button key={n} className={count === n ? 'active' : ''} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="lobby-players">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="lobby-player">
              <span className="swatch lg" style={{ background: PLAYER_FILL[colors[i]!] }} />
              <input
                value={names[i]}
                maxLength={16}
                onChange={(e) => setNames((p) => { const n = [...p]; n[i] = e.target.value; return n; })}
              />
              <div className="color-pick">
                {PLAYER_COLORS.map((c) => (
                  <button
                    key={c}
                    title={PLAYER_LABEL[c]}
                    className={`color-dot${colors[i] === c ? ' active' : ''}`}
                    style={{ background: PLAYER_FILL[c] }}
                    onClick={() => setColor(i, c)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="lobby-field">
          <label>Seed (opcional)</label>
          <div className="seed-row">
            <input
              value={seedText}
              placeholder="aleatória"
              onChange={(e) => setSeedText(e.target.value)}
            />
            <button onClick={() => setSeedText('')}>🎲 Aleatória</button>
          </div>
          <span className="lobby-hint">Mesma seed = mesmo tabuleiro. Deixe vazio para sortear.</span>
        </div>

        <button className="primary big" onClick={start}>Começar partida</button>
      </div>
    </div>
  );
}

/** Converte um texto de seed em um inteiro determinístico. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
