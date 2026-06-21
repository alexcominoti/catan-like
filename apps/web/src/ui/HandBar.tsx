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

const DEV_ORDER: ProgressCard[] = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'];

/** Uma pilha de cartas do mesmo tipo: cartas de tras (cobertas) + a da frente. */
function CardStack({
  count,
  fill,
  icon,
  title,
  dev,
  playable,
  onPlay,
}: {
  count: number;
  fill?: string;
  icon: string;
  title: string;
  dev?: boolean;
  playable?: boolean;
  onPlay?: () => void;
}) {
  const backs = Math.min(count - 1, 3);
  return (
    <div
      className={`card-stack${onPlay ? ' clickable' : ''}${playable ? ' playable' : ''}`}
      title={`${title}${count > 1 ? ` ×${count}` : ''}${playable ? ' — clique para jogar' : ''}`}
      onClick={onPlay}
    >
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

/** Mão do jogador local: recursos e cartas de progresso no mesmo bloco. */
export function HandBar({
  hand,
  devCards,
  name,
  canPlay,
  onPlay,
}: {
  hand: Record<Resource, number>;
  devCards: ProgressCard[];
  name: string;
  canPlay: (c: ProgressCard) => boolean;
  onPlay: (c: ProgressCard) => void;
}) {
  const total = RESOURCES.reduce((s, r) => s + hand[r], 0);
  const devCounts = new Map<ProgressCard, number>();
  for (const c of devCards) devCounts.set(c, (devCounts.get(c) ?? 0) + 1);
  const devList = DEV_ORDER.filter((c) => devCounts.has(c));

  return (
    <div className="hand-bar">
      <div className="hand-bar-name">{name}</div>
      <div className="hand-cards">
        {total === 0 && devList.length === 0 && <span className="muted-note">Sem cartas</span>}
        {RESOURCES.filter((r) => hand[r] > 0).map((r) => (
          <CardStack key={r} count={hand[r]} fill={CARD_FILL[r]} icon={RESOURCE_ICON[r]} title={RESOURCE_LABEL[r]} />
        ))}
        {devList.length > 0 && (
          <div className="dev-divider">
            {devList.map((c) => {
              const ok = c !== 'victoryPoint' && canPlay(c);
              return (
                <CardStack
                  key={c}
                  count={devCounts.get(c)!}
                  icon={DEV_META[c].icon}
                  title={DEV_META[c].label}
                  dev
                  playable={ok}
                  onPlay={ok ? () => onPlay(c) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
