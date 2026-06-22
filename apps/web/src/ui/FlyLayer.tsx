import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

export interface Pt {
  x: number;
  y: number;
}

export interface FlyItem {
  id: number;
  kind: 'card' | 'robber';
  img?: string;
  from: Pt;
  to: Pt;
  delay: number;
  duration: number;
}

export interface FlyOpts {
  kind: 'card' | 'robber';
  img?: string;
  from: Pt;
  to: Pt;
  delay?: number;
  duration?: number;
}

/** Hook que gerencia as cartas/peças voando e expõe `fly()`. */
export function useFlyer() {
  const [items, setItems] = useState<FlyItem[]>([]);
  const idRef = useRef(0);

  const fly = useCallback((opts: FlyOpts) => {
    const id = ++idRef.current;
    const item: FlyItem = { id, delay: 0, duration: 620, ...opts };
    setItems((s) => [...s, item]);
    window.setTimeout(() => {
      setItems((s) => s.filter((x) => x.id !== id));
    }, item.delay + item.duration + 120);
  }, []);

  return { items, fly };
}

export function FlyLayer({ items }: { items: FlyItem[] }) {
  return (
    <div className="fly-layer">
      {items.map((it) => (
        <FlyEl key={it.id} item={it} />
      ))}
    </div>
  );
}

function FlyEl({ item }: { item: FlyItem }) {
  const [pos, setPos] = useState<Pt>(item.from);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const r1 = requestAnimationFrame(() =>
      requestAnimationFrame(() => setPos(item.to)),
    );
    const t = window.setTimeout(() => setGone(true), item.delay + item.duration - 100);
    return () => {
      cancelAnimationFrame(r1);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const w = item.kind === 'robber' ? 22 : 36;
  const h = item.kind === 'robber' ? 30 : 50;
  const style: CSSProperties = {
    width: w,
    height: h,
    transform: `translate(${pos.x - w / 2}px, ${pos.y - h / 2}px) scale(${pos === item.from ? 0.6 : 1})`,
    transition: `transform ${item.duration}ms cubic-bezier(0.34, 0.1, 0.2, 1) ${item.delay}ms, opacity 240ms ${item.delay}ms`,
    opacity: gone ? 0 : 1,
  };

  if (item.kind === 'robber') {
    return <div className="fly-el fly-robber" style={style} />;
  }
  return <img className="fly-el fly-card" src={item.img} alt="" style={style} />;
}
