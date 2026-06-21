import { useEffect, useRef, useState } from 'react';

/** Posicoes dos pips (grade 3x3) para cada face 1..6. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function Die({ value, color }: { value: number; color: string }) {
  const cells = PIPS[value] ?? [];
  const pos = (i: number) => 8 + i * 12; // 3 colunas/linhas em 32px
  return (
    <svg width={32} height={32} viewBox="0 0 32 32" aria-label={`dado ${value}`}>
      <rect x={1} y={1} width={30} height={30} rx={6} fill="#f3ead0" stroke="#0c1118" strokeWidth={1.5} />
      {cells.map(([cx, cy], i) => (
        <circle key={i} cx={pos(cx)} cy={pos(cy)} r={3} fill={color} />
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
      if (ticks >= 6) {
        clearInterval(id);
        setShown(dice);
        setRolling(false);
      } else {
        setShown([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
      }
    }, 60);
    return () => clearInterval(id);
  }, [dice]);

  if (!dice) return null;
  const sum = shown[0] + shown[1];
  return (
    <span className={`dice-faces${rolling ? ' rolling' : ''}`}>
      <Die value={shown[0]} color="#c0392b" />
      <Die value={shown[1]} color="#1a1a1a" />
      {!rolling && <b className="dice-sum">{sum}</b>}
    </span>
  );
}
