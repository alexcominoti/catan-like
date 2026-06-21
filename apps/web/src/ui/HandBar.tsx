import { RESOURCES, type ProgressCard, type Resource } from '@hexgame/engine';
import { RESOURCE_ICON, RESOURCE_LABEL } from '../game/theme.js';

const CARD_FILL: Record<Resource, string> = {
  wood: '#2f7d45',
  brick: '#b5562f',
  wool: '#7fae3f',
  grain: '#e3b23c',
  ore: '#8d97a3',
};

const DEV_LABEL: Record<ProgressCard, string> = {
  knight: '⚔️ Cavaleiro',
  roadBuilding: '🛣️ 2 Estradas',
  yearOfPlenty: '🎁 +2 Recursos',
  monopoly: '📦 Monopólio',
  victoryPoint: '⭐ Ponto',
};

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
  return (
    <div className="hand-bar">
      <div className="hand-bar-name">{name}</div>
      <div className="hand-cards">
        {total === 0 && devCards.length === 0 && <span className="muted-note">Sem cartas</span>}
        {RESOURCES.filter((r) => hand[r] > 0).map((r) => (
          <div key={r} className="card-group">
            {Array.from({ length: hand[r] }, (_, i) => (
              <div key={i} className="play-card" style={{ background: CARD_FILL[r] }} title={RESOURCE_LABEL[r]}>
                <span className="play-card-icon">{RESOURCE_ICON[r]}</span>
              </div>
            ))}
          </div>
        ))}
        {devCards.length > 0 && (
          <div className="card-group dev-group">
            {devCards.map((c, i) => (
              <div key={i} className="play-card dev" title={DEV_LABEL[c]}>
                <span className="play-card-icon">{DEV_LABEL[c].split(' ')[0]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
