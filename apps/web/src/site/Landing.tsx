import type { ReactNode } from 'react';
import { Zap, Users, Trophy, Hexagon, ShieldCheck, Sparkles, Map } from 'lucide-react';

const RESOURCE_PILLS: { label: string; color: string }[] = [
  { label: 'Tijolo', color: '#c0563a' },
  { label: 'Madeira', color: '#6e4a2f' },
  { label: 'Ovelha', color: '#7fae3f' },
  { label: 'Trigo', color: '#e3b23c' },
  { label: 'Pedra', color: '#6b7480' },
];

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <Zap size={20} />, title: 'Partidas rápidas', text: 'Encontre um jogo em segundos com matchmaking por elo.' },
  { icon: <Users size={20} />, title: 'Salões privados', text: 'Convide amigos por link, defina regras, expansões e bots.' },
  { icon: <Trophy size={20} />, title: 'Ranqueadas', text: 'Suba do Colono a Grão-Mestre em temporadas mensais.' },
  { icon: <Map size={20} />, title: 'Mapas customizados', text: 'Beira-mar, Cavaleiros, Cidades & Cavalaria e mais.' },
  { icon: <ShieldCheck size={20} />, title: 'Jogo justo', text: 'Detecção anti-conluio e relógio de turno configurável.' },
  { icon: <Sparkles size={20} />, title: 'Replays', text: 'Revise cada lance, cada troca, cada cartão de progresso.' },
];

const HEX = [
  { x: 96, y: 40, c: '#6f8f52' },
  { x: 150, y: 40, c: '#e0b53f' },
  { x: 204, y: 40, c: '#c0563a' },
  { x: 96, y: 86, c: '#5b3a22' },
  { x: 150, y: 86, c: '#cf9a6a', label: 'Trevalis' },
  { x: 204, y: 86, c: '#5d7385' },
  { x: 150, y: 132, c: '#e0b53f' },
];

export function Landing({ onPlay, onWatch }: { onPlay: () => void; onWatch: () => void }) {
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <span className="badge-pill"><Sparkles size={13} /> BETA ABERTA · GRÁTIS PARA JOGAR</span>
          <h1>Construa, troque e <span className="accent-text">conquiste</span> a ilha.</h1>
          <p>
            Trevalis é o jeito mais rápido de jogar colonização hexagonal com amigos. Sem download,
            sem cadastro obrigatório — abra um salão e comece em 30 segundos.
          </p>
          <div className="hero-buttons">
            <button className="cta big" onClick={onPlay}>Entrar no lobby</button>
            <button className="ghost big" onClick={onWatch}>Ver uma partida</button>
          </div>
          <div className="hero-stats">
            <span><Users size={15} /> 12,4k jogadores online</span>
            <span><ShieldCheck size={15} /> Anticheat ativo</span>
            <span><Zap size={15} /> Servidor BR</span>
          </div>
        </div>
        <div className="hero-art">
          <svg viewBox="0 0 300 200" width="100%" aria-hidden="true">
            {HEX.map((h, i) => (
              <g key={i}>
                <polygon points={hexPts(h.x, h.y, 30)} fill={h.c} stroke="rgba(0,0,0,0.15)" strokeWidth={1.5} />
                {h.label && (
                  <text x={h.x} y={h.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#2f2a26" fontFamily="DM Serif Display, serif">
                    {h.label}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      </section>

      <section className="resource-strip">
        <span className="strip-title">Cinco recursos. Infinitas estratégias.</span>
        <div className="pills">
          {RESOURCE_PILLS.map((p) => (
            <span key={p.label} className="pill" style={{ background: p.color }}>{p.label}</span>
          ))}
        </div>
      </section>

      <section className="features">
        <h2>Tudo o que sua mesa precisa.</h2>
        <p className="features-sub">Mecânicas fiéis, interface limpa e ferramentas que economizam o seu turno.</p>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-card">
              <span className="feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="site-footer">
        <span className="foot-brand"><Hexagon size={15} /> Trevalis © 2026</span>
        <span className="foot-links"><a>Regras</a> <a>Discord</a> <a>Contato</a></span>
      </footer>
    </div>
  );
}

function hexPts(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(' ');
}
