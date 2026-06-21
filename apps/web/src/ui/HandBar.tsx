import { RESOURCES, type ProgressCard, type Resource } from '@hexgame/engine';
import { RESOURCE_LABEL } from '../game/theme.js';
import cardBrick from '../assets/card-brick.jpg';
import cardWood from '../assets/card-wood.jpg';
import cardSheep from '../assets/card-sheep.jpg';
import cardWheat from '../assets/card-wheat.jpg';
import cardOre from '../assets/card-ore.jpg';
import cardKnight from '../assets/card-knight.jpg';
import cardRoad from '../assets/card-road.jpg';
import cardVictory from '../assets/card-victory.jpg';

const RES_IMG: Record<Resource, string> = {
  wood: cardWood,
  brick: cardBrick,
  wool: cardSheep,
  grain: cardWheat,
  ore: cardOre,
};

const DEV_IMG: Record<ProgressCard, string> = {
  knight: cardKnight,
  roadBuilding: cardRoad,
  yearOfPlenty: cardVictory,
  monopoly: cardVictory,
  victoryPoint: cardVictory,
};

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
  playable,
  onPlay,
}: {
  count: number;
  img: string;
  title: string;
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
        <CardPile key={r} count={hand[r]} img={RES_IMG[r]} title={RESOURCE_LABEL[r]} />
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
            playable={ok}
            onPlay={ok ? () => onPlay(c) : undefined}
          />
        );
      })}
    </div>
  );
}
