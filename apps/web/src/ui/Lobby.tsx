import { useMemo, useState } from 'react';
import { PLAYER_COLORS, type DesertPlacement, type NumberLayout, type PlayerColor } from '@hexgame/engine';
import type { Difficulty } from '@hexgame/bot';
import type { ReactNode } from 'react';
import { Users, Bot, Dices, Target, Play, ArrowLeft, Shuffle, UserPlus, X, Crown } from 'lucide-react';
import { PLAYER_FILL, PLAYER_LABEL } from '../game/theme.js';
import { pickBotName } from '../game/botNames.js';

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

/** Crests por cor (mesmos do jogo) para a UI ficar coerente. */
const CREST: Record<PlayerColor, string> = { red: '👑', blue: '🌿', white: '⚒️', orange: '🪓' };
const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };

type Seat = { type: 'host' } | { type: 'open' } | { type: 'bot'; diff: Difficulty; name: string };

export function Lobby({ onStart, onBack }: { onStart: (cfg: GameConfig) => void; onBack?: () => void }) {
  const [roomSize, setRoomSize] = useState(4);
  const [hostName, setHostName] = useState('Você');
  // Sala recem-criada: so o anfitriao; as demais vagas comecam ABERTAS.
  const [seats, setSeats] = useState<Seat[]>([{ type: 'host' }, { type: 'open' }, { type: 'open' }, { type: 'open' }]);
  const [numberLayout, setNumberLayout] = useState<NumberLayout>('balanced');
  const [desert, setDesert] = useState<DesertPlacement>('random');
  const [pointsToWin, setPointsToWin] = useState(10);
  const [discardLimit, setDiscardLimit] = useState(7);
  const [seedText, setSeedText] = useState('');

  const visible = seats.slice(0, roomSize);

  // Cada assento ocupado recebe uma cor na ORDEM de preenchimento (host, depois bots).
  const colorByIndex = useMemo(() => {
    const out: (PlayerColor | null)[] = [];
    let ci = 0;
    for (const s of visible) out.push(s.type === 'open' ? null : PLAYER_COLORS[ci++]!);
    return out;
  }, [visible]);

  const filledCount = colorByIndex.filter(Boolean).length;
  const canStart = filledCount >= 3;

  function setSeat(i: number, s: Seat) {
    setSeats((prev) => {
      const next = [...prev];
      next[i] = s;
      return next;
    });
  }

  function addBot(i: number) {
    setSeats((prev) => {
      const used = [hostName.trim(), ...prev.flatMap((s) => (s.type === 'bot' ? [s.name] : []))];
      const next = [...prev];
      next[i] = { type: 'bot', diff: 'medium', name: pickBotName(used).name };
      return next;
    });
  }

  function start() {
    if (!canStart) return;
    const seed = seedText.trim() === '' ? Math.floor(Math.random() * 0x7fffffff) : hashSeed(seedText.trim());
    const players: { color: PlayerColor; name: string }[] = [];
    const bots: PlayerColor[] = [];
    const botDifficulty: Record<string, Difficulty> = {};
    let ci = 0;
    visible.forEach((s) => {
      if (s.type === 'open') return;
      const color = PLAYER_COLORS[ci++]!;
      if (s.type === 'host') {
        players.push({ color, name: hostName.trim() || 'Você' });
      } else {
        players.push({ color, name: s.name });
        bots.push(color);
        botDifficulty[color] = s.diff;
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
          <div className="su-players-head">
            <h2 className="su-h"><Users size={18} className="ic-primary" /> Jogadores <span className="su-count">{filledCount}/{roomSize}</span></h2>
            <div className="su-seg sm">
              {[3, 4].map((n) => (
                <button key={n} className={roomSize === n ? 'on' : ''} onClick={() => setRoomSize(n)}>{n}</button>
              ))}
            </div>
          </div>
          <p className="su-note">Convide amigos pelo link ou preencha as vagas com bots.</p>

          {visible.map((s, i) => {
            const color = colorByIndex[i];
            if (s.type === 'open') {
              return (
                <div key={i} className="su-seat open">
                  <span className="su-open-label"><UserPlus size={16} /> Vaga aberta <em>aguardando jogador</em></span>
                  <button className="su-addbot" onClick={() => addBot(i)}><Bot size={15} /> Adicionar bot</button>
                </div>
              );
            }
            const c = color!;
            if (s.type === 'host') {
              return (
                <div key={i} className="su-seat filled" style={{ borderLeftColor: PLAYER_FILL[c] }}>
                  <span className="su-crest" style={{ background: PLAYER_FILL[c] }} title={PLAYER_LABEL[c]}>{CREST[c]}</span>
                  <input className="su-name" value={hostName} maxLength={16} onChange={(e) => setHostName(e.target.value)} />
                  <span className="su-tag host"><Crown size={12} /> Anfitrião</span>
                </div>
              );
            }
            return (
              <div key={i} className="su-seat filled bot" style={{ borderLeftColor: PLAYER_FILL[c] }}>
                <div className="su-seat-row">
                  <span className="su-crest" style={{ background: PLAYER_FILL[c] }} title={PLAYER_LABEL[c]}>{CREST[c]}</span>
                  <span className="su-name bot-name"><Bot size={14} /> {s.name}</span>
                  <button className="su-remove" title="Liberar vaga" onClick={() => setSeat(i, { type: 'open' })}><X size={15} /></button>
                </div>
                <div className="su-seg xs su-seat-diff">
                  {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                    <button key={d} className={s.diff === d ? 'on' : ''} onClick={() => setSeat(i, { type: 'bot', diff: d, name: s.name })}>{DIFF_LABEL[d]}</button>
                  ))}
                </div>
              </div>
            );
          })}
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

          <button className="cta big su-start" disabled={!canStart} onClick={start}>
            <Play size={16} /> {canStart ? 'Começar partida' : 'Mínimo de 3 jogadores'}
          </button>
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
