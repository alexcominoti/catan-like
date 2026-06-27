/**
 * Seed aleatoria imprevisivel (32 bits) usando a CSPRNG do navegador
 * (crypto.getRandomValues). Cai para Math.random apenas se crypto faltar.
 * Mantemos a seed como NUMERO para o motor seguir deterministico (replays),
 * mas a origem deixa de ser previsivel.
 */
export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint32Array(1))[0]!;
  }
  return Math.floor(Math.random() * 0x100000000);
}
