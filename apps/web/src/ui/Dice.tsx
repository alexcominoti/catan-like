import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.js';

/** Posicoes dos pips (grade 3x3) para cada face 1..6. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

const SIZE = 42;

function Die({ value, accent }: { value: number; accent: boolean }) {
  const t = useT();
  const cells = PIPS[value] ?? [];
  const pos = (i: number) => SIZE * 0.25 + i * SIZE * 0.25; // 3 colunas/linhas
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-label={t('game.diceAria', { n: value })}>
      <rect
        x={2}
        y={2}
        width={SIZE - 4}
        height={SIZE - 4}
        rx={8}
        fill="#fbfbf7"
        stroke={accent ? '#c0392b' : '#2a2a2a'}
        strokeWidth={2}
      />
      {cells.map(([cx, cy], i) => (
        <circle key={i} cx={pos(cx)} cy={pos(cy)} r={4} fill={accent ? '#c0392b' : '#1a1a1a'} />
      ))}
    </svg>
  );
}

/** Dois dados; faz uma rolagem rapida quando os valores mudam. */
export function Dice({ dice }: { dice: [number, number] | null }) {
  const [shown, setShown] = useState<[number, number]>(dice ?? [1, 1]);
  const [rolling, setRolling] = useState(false);
  const prev = useRef<string>('');

  useEffect(() => {
    if (!dice) return;
    const key = dice.join(',');
    if (key === prev.current) return;
    prev.current = key;
    setRolling(true);
    let ticks = 0;
    const id = setInterval(() => {
      ticks++;
      if (ticks >= 7) {
        clearInterval(id);
        setShown(dice);
        setRolling(false);
      } else {
        setShown([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
      }
    }, 55);
    return () => clearInterval(id);
  }, [dice]);

  if (!dice) return null;
  const sum = shown[0] + shown[1];
  const hot = !rolling && sum === 7;
  return (
    <span className={`dice-faces${rolling ? ' rolling' : ''}`}>
      <Die value={shown[0]} accent={false} />
      <Die value={shown[1]} accent={false} />
      <b className={`dice-sum${hot ? ' hot' : ''}`}>{rolling ? '…' : sum}</b>
    </span>
  );
}
