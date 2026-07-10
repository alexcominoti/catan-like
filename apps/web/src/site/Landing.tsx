import { useEffect, useState, type ReactNode } from 'react';
import { Zap, Users, Trophy, Hexagon, ShieldCheck, Sparkles, Map } from 'lucide-react';
import { getOnlineCount } from './social.js';
import { useT, useLang, type MsgKey } from '../i18n/index.js';

const RESOURCE_PILLS: { key: MsgKey; color: string }[] = [
  { key: 'resource.brick', color: '#c0563a' },
  { key: 'resource.wood', color: '#6e4a2f' },
  { key: 'resource.grain', color: '#e3b23c' },
  { key: 'resource.wool', color: '#7fae3f' },
  { key: 'resource.ore', color: '#6b7480' },
];

const FEATURES: { icon: ReactNode; titleKey: MsgKey; textKey: MsgKey }[] = [
  { icon: <Zap size={20} />, titleKey: 'landing.feat.quick.title', textKey: 'landing.feat.quick.text' },
  { icon: <Users size={20} />, titleKey: 'landing.feat.private.title', textKey: 'landing.feat.private.text' },
  { icon: <Trophy size={20} />, titleKey: 'landing.feat.ranked.title', textKey: 'landing.feat.ranked.text' },
  { icon: <Map size={20} />, titleKey: 'landing.feat.maps.title', textKey: 'landing.feat.maps.text' },
  { icon: <ShieldCheck size={20} />, titleKey: 'landing.feat.fair.title', textKey: 'landing.feat.fair.text' },
  { icon: <Sparkles size={20} />, titleKey: 'landing.feat.replays.title', textKey: 'landing.feat.replays.text' },
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
  const t = useT();
  const { lang } = useLang();
  // Contador REAL de jogadores online (serviço de presença; item da landing no
  // backlog). Atualiza a cada 30s. Só aparece quando há alguém online.
  const [online, setOnline] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => void getOnlineCount().then((n) => alive && setOnline(n));
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <span className="badge-pill"><Sparkles size={13} /> {t('landing.badge')}</span>
          <h1>{t('landing.titlePre')}<span className="accent-text">{t('landing.titleAccent')}</span>{t('landing.titlePost')}</h1>
          <p>{t('landing.subtitle')}</p>
          <div className="hero-buttons">
            <button className="cta big" onClick={onPlay}>{t('landing.enterLobby')}</button>
            <button className="ghost big" onClick={onWatch}>{t('landing.watchGame')}</button>
          </div>
          {/*
            "Anticheat ativo" segue removido (sem implementação). O contador de
            jogadores online agora é REAL (serviço de presença — GET /api/presence).
            Ver docs/backlog.md → Landing.
          */}
          <div className="hero-stats">
            {online != null && online > 0 && (
              <span className="online-stat">
                <i className="presence-pulse" /> {online.toLocaleString(lang)} {online === 1 ? t('landing.playerOnline') : t('landing.playersOnline')}
              </span>
            )}
            <span><Zap size={15} /> {t('landing.serverBr')}</span>
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
        <span className="strip-title">{t('landing.stripTitle')}</span>
        <div className="pills">
          {RESOURCE_PILLS.map((p) => (
            <span key={p.key} className="pill" style={{ background: p.color }}>{t(p.key)}</span>
          ))}
        </div>
      </section>

      <section className="features">
        <h2>{t('landing.featuresTitle')}</h2>
        <p className="features-sub">{t('landing.featuresSub')}</p>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.titleKey} className="feature-card">
              <span className="feature-icon">{f.icon}</span>
              <h3>{t(f.titleKey)}</h3>
              <p>{t(f.textKey)}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="site-footer">
        <span className="foot-brand"><Hexagon size={15} /> Trevalis © 2026</span>
        {/*
          Links removidos: Regras / Discord / Contato — nenhum tinha destino real.
          Ver docs/backlog.md → Landing. Religar com href reais quando existirem.
        */}
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
