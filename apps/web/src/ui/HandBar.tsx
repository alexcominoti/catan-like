import { RESOURCES, type ProgressCard, type Resource } from '@hexgame/engine';
import { RESOURCE_ICON, RESOURCE_LABEL } from '../game/theme.js';

const CARD_FILL: Record<Resource, string> = {
  wood: '#2f7d45',
  brick: '#b5562f',
  wool: '#7fae3f',
  grain: '#e3b23c',
  ore: '#8d97a3',
};

const DEV_META: Record<ProgressCard, { icon: string; label: string }> = {
  knight: { icon: '⚔️', label: 'Cavaleiro' },
  roadBuilding: { icon: '🛣️', label: '2 Estradas' },
  yearOfPlenty: { icon: '🎁', label: '+2 Recursos' },
  monopoly: { icon: '📦', label: 'Monopólio' },
  victoryPoint: { icon: '⭐', label: 'Ponto de Vitória' },
};

/** Uma pilha de cartas do mesmo tipo: cartas de tras (cobertas) + a da frente. */
function CardStack({ count, fill, icon, title, dev }: { count: number; fill?: string; icon: string; title: string; dev?: boolean }) {
  const backs = Math.min(count - 1, 3);
  return (
    <div className="card-stack" title={`${title}${count > 1 ? ` ×${count}` : ''}`}>
      {Array.from({ length: backs }, (_, i) => (
        <div key={i} className={`play-card back${dev ? ' dev' : ''}`} style={{ left: (i + 1) * 5, background: fill }} />
      ))}
      <div className={`play-card front${dev ? ' dev' : ''}`} style={{ background: fill }}>
        <span className="play-card-icon">{icon}</span>
        {count > 1 && <span className="card-count">{count}</span>}
      </div>
    </div>
  );
}

/** Mão do jogador local mostrada como cartinhas, na base da janela. */
export function HandBar({
  hand,
  devCards,
  name,
}: {
  hand: Record<Resource, number>;
  devCards: ProgressCard[];
  name: string;
}) {
  const total = RESOURCES.reduce((s, r) => s + hand[r], 0);
  const devCounts = new Map<ProgressCard, number>();
  for (const c of devCards) devCounts.set(c, (devCounts.get(c) ?? 0) + 1);

  return (
    <div className="hand-bar">
      <div className="hand-bar-name">{name}</div>
      <div className="hand-cards">
        {total === 0 && devCards.length === 0 && <span className="muted-note">Sem cartas</span>}
        {RESOURCES.filter((r) => hand[r] > 0).map((r) => (
          <CardStack key={r} count={hand[r]} fill={CARD_FILL[r]} icon={RESOURCE_ICON[r]} title={RESOURCE_LABEL[r]} />
        ))}
        {devCounts.size > 0 && (
          <div className="dev-divider">
            {[...devCounts.entries()].map(([c, n]) => (
              <CardStack key={c} count={n} icon={DEV_META[c].icon} title={DEV_META[c].label} dev />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
