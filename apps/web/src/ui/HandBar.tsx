import { RESOURCES, type ProgressCard, type Resource } from '@trevalis/engine';
import { RESOURCE_LABEL } from '../game/theme.js';
import { RES_IMG, DEV_IMG } from '../game/cards.js';

const DEV_LABEL: Record<ProgressCard, string> = {
  knight: 'Cavaleiro',
  roadBuilding: '2 Estradas',
  yearOfPlenty: '+2 Recursos',
  monopoly: 'Monopólio',
  victoryPoint: 'Ponto de Vitória',
};

const DEV_ORDER: ProgressCard[] = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'];

/** Pilha de cartas (imagens) do mesmo tipo, com contador. */
function CardPile({
  count,
  img,
  title,
  dataKey,
  playable,
  onPlay,
}: {
  count: number;
  img: string;
  title: string;
  dataKey: string;
  playable?: boolean;
  onPlay?: () => void;
}) {
  const width = 64 + (count - 1) * 9;
  return (
    <button
      type="button"
      className={`card-pile${onPlay ? ' clickable' : ''}${playable ? ' playable' : ''}`}
      title={`${title}${count > 1 ? ` ×${count}` : ''}${playable ? ' — clique para jogar' : ''}`}
      onClick={onPlay}
      disabled={!onPlay}
      data-card={dataKey}
    >
      <span className="card-pile-inner" style={{ width }}>
        {Array.from({ length: count }, (_, i) => (
          <img key={i} src={img} alt={title} className="play-img" style={{ left: i * 9 }} loading="lazy" />
        ))}
      </span>
      <span className="card-count">{count}</span>
    </button>
  );
}

/** Mão do jogador local: recursos e cartas de progresso (imagens), num só bloco. */
export function HandBar({
  hand,
  devCards,
  canPlay,
  onPlay,
}: {
  hand: Record<Resource, number>;
  devCards: ProgressCard[];
  canPlay: (c: ProgressCard) => boolean;
  onPlay: (c: ProgressCard) => void;
}) {
  const total = RESOURCES.reduce((s, r) => s + hand[r], 0);
  const devCounts = new Map<ProgressCard, number>();
  for (const c of devCards) devCounts.set(c, (devCounts.get(c) ?? 0) + 1);
  const devList = DEV_ORDER.filter((c) => devCounts.has(c));

  return (
    <div className="hand-cards">
      {total === 0 && devList.length === 0 && <span className="muted-note">Sem cartas</span>}
      {RESOURCES.filter((r) => hand[r] > 0).map((r) => (
        <CardPile key={r} count={hand[r]} img={RES_IMG[r]} title={RESOURCE_LABEL[r]} dataKey={r} />
      ))}
      {devList.length > 0 && <span className="hand-divider" aria-hidden="true" />}
      {devList.map((c) => {
        const ok = c !== 'victoryPoint' && canPlay(c);
        return (
          <CardPile
            key={c}
            count={devCounts.get(c)!}
            img={DEV_IMG[c]}
            title={DEV_LABEL[c]}
            dataKey={c}
            playable={ok}
            onPlay={ok ? () => onPlay(c) : undefined}
          />
        );
      })}
    </div>
  );
}
