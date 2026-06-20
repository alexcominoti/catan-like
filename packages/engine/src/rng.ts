import type { RngState } from './types.js';

/**
 * PRNG determinístico e *puro*.
 *
 * O estado e apenas { seed, counter }, totalmente serializavel. Cada avanco
 * incrementa o counter; o valor e derivado por hash de (seed, counter), de
 * modo que a mesma (seed + sequencia de avancos) reproduz exatamente o mesmo
 * fluxo. Isso e a base dos replays e dos testes deterministicos.
 *
 * O rng NUNCA deve ser enviado ao cliente (vazaria o futuro do baralho).
 */

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0, counter: 0 };
}

/** Hash inteiro de 32 bits (splitmix32). */
function mix32(x: number): number {
  let z = (x + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return z >>> 0;
}

/** Proximo inteiro sem sinal de 32 bits + novo estado. */
export function nextUint(rng: RngState): { value: number; rng: RngState } {
  const value = mix32((Math.imul(rng.seed, 0x9e3779b1) + rng.counter) | 0);
  return { value, rng: { seed: rng.seed, counter: rng.counter + 1 } };
}

/** Float uniforme em [0, 1). */
export function nextFloat(rng: RngState): { value: number; rng: RngState } {
  const u = nextUint(rng);
  return { value: u.value / 0x100000000, rng: u.rng };
}

/** Inteiro uniforme em [0, maxExclusive). */
export function nextInt(rng: RngState, maxExclusive: number): { value: number; rng: RngState } {
  if (maxExclusive <= 0) throw new Error('nextInt: maxExclusive deve ser > 0');
  const f = nextFloat(rng);
  return { value: Math.floor(f.value * maxExclusive), rng: f.rng };
}

/** Rolagem de 1 dado (1..6). */
export function rollDie(rng: RngState): { value: number; rng: RngState } {
  const r = nextInt(rng, 6);
  return { value: r.value + 1, rng: r.rng };
}

/** Embaralhamento Fisher-Yates puro (nao muta a entrada). */
export function shuffle<T>(rng: RngState, input: readonly T[]): { value: T[]; rng: RngState } {
  const arr = input.slice();
  let cur = rng;
  for (let i = arr.length - 1; i > 0; i--) {
    const r = nextInt(cur, i + 1);
    cur = r.rng;
    const j = r.value;
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return { value: arr, rng: cur };
}
