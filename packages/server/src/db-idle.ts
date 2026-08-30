/**
 * Sinais de ociosidade do banco: deixam os timers periódicos (matchmaking e
 * limpeza de salas 'waiting') PULAREM a query quando não há nada a fazer.
 *
 * Por que existe: o Neon suspende o compute depois de alguns minutos sem query
 * — é assim que o uso cabe na cota de compute-hours do plano. Um `select` a cada
 * 5 s mantinha o banco acordado 24 h por dia, com zero jogadores online, até a
 * cota estourar; aí TODA query passa a falhar e o login e a recuperação de senha
 * caem junto (foi o que aconteceu). Servidor ocioso agora não toca no banco.
 *
 * O estado vive em MEMÓRIA, o que só é correto porque toda entrada na fila e
 * toda criação/renovação de sala passa por aqui ANTES de virar linha no banco —
 * ou seja, vale para UM processo, que é a topologia atual (1 máquina no Fly).
 * Os dois sinais nascem ARMADOS: logo após um restart há uma passada que
 * recupera o que já estava no banco de antes.
 */

/* ------------------------------------------------------------------ */
/* Matchmaking                                                         */
/* ------------------------------------------------------------------ */

let matchmaking = true;

/** Alguém entrou na fila do "Jogo rápido": o tick volta a ter o que fazer. */
export function armMatchmaking(): void {
  matchmaking = true;
}

/** O tick do matchmaking precisa consultar o banco? */
export function matchmakingArmed(): boolean {
  return matchmaking;
}

/**
 * Nenhuma mesa matchmade com humano sentado: nada pode avançar sozinho, então o
 * tick para até alguém entrar na fila (`armMatchmaking`).
 */
export function disarmMatchmaking(): void {
  matchmaking = false;
}

/* ------------------------------------------------------------------ */
/* Varredura de salas 'waiting' inativas                               */
/* ------------------------------------------------------------------ */

/**
 * Instante da atividade de sala mais recente, ou `null` quando não há nada que
 * possa vencer o TTL. Começa em "agora" (e não em `null`) para cobrir as salas
 * criadas ANTES de um restart: elas vencem o TTL no máximo uma janela depois do
 * boot, e até lá a varredura segue armada.
 */
let roomActivityAt: number | null = Date.now();

/** Sala criada ou renovada: passa a existir algo que um dia vence o TTL. */
export function armRoomSweep(now: number = Date.now()): void {
  roomActivityAt = now;
}

/** A varredura de salas inativas precisa rodar? */
export function roomSweepArmed(): boolean {
  return roomActivityAt !== null;
}

/**
 * Fim de uma varredura: se a atividade mais recente já é mais velha que o TTL,
 * tudo que podia expirar acabou de ser removido — desarma até haver sala nova.
 */
export function noteRoomSweepDone(ttlMs: number, now: number = Date.now()): void {
  if (roomActivityAt !== null && now - roomActivityAt >= ttlMs) roomActivityAt = null;
}

/** Só para os testes: volta ao estado de boot (os dois sinais armados). */
export function resetDbIdleSignals(now: number = Date.now()): void {
  matchmaking = true;
  roomActivityAt = now;
}
