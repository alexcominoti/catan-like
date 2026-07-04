/**
 * Karma (anti-abandono, inspirado no Colonist) — NÚCLEO PURO, sem I/O.
 *
 * Karma mede o quão confiável um jogador é em levar as partidas até o fim: a
 * razão entre partidas concluídas (terminou conectado) e partidas abandonadas
 * (a vaga humana virou bot antes do fim). É mostrado no perfil para que todos
 * saibam com quem estão jogando.
 *
 * Regras de produto:
 *  - Jogador novo (sem amostra) começa com karma CHEIO (100%) — nunca punir por
 *    falta de histórico (mesma escolha do Colonist).
 *  - Karma% = concluídas / (concluídas + abandonadas), arredondado.
 */

/** Amostra mínima antes de o karma "valer" (abaixo disso mostramos 100%). */
export const KARMA_MIN_SAMPLE = 3;

/** % de karma (0..100) a partir dos contadores. Sem amostra suficiente → 100. */
export function karmaPercent(completed: number, abandoned: number): number {
  const total = completed + abandoned;
  if (total < KARMA_MIN_SAMPLE) return 100;
  return Math.round((completed / total) * 100);
}

/** O karma do jogador atinge o mínimo exigido por uma sala? (`min` 0 = sem filtro). */
export function meetsKarma(karma: number, min: number): boolean {
  return karma >= min;
}
