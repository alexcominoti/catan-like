/**
 * Presença online (Tier 1, item 4) — quem está com o app aberto agora.
 *
 * Em memória (por processo): cada usuário autenticado "toca" a presença
 * periodicamente (heartbeat HTTP) informando opcionalmente em qual sala está.
 * Uma entrada expira após `ttlMs` sem heartbeat. Alimenta o contador de
 * "jogadores online" da landing e o status online/sala dos amigos.
 *
 * `now` é injetável para tornar a lógica de expiração determinística nos testes.
 */
export class PresenceTracker {
  private readonly seen = new Map<string, { at: number; room: string | null }>();
  private readonly ttlMs: number;

  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs;
  }

  /** Registra atividade de um usuário (heartbeat). `room` = sala atual, se houver. */
  touch(userId: string, room: string | null = null, now: number = Date.now()): void {
    this.seen.set(userId, { at: now, room });
  }

  /** Remove entradas expiradas (chamado antes de qualquer leitura). */
  private prune(now: number): void {
    for (const [id, v] of this.seen) {
      if (now - v.at > this.ttlMs) this.seen.delete(id);
    }
  }

  /** Quantos usuários distintos estão online agora. */
  count(now: number = Date.now()): number {
    this.prune(now);
    return this.seen.size;
  }

  /** Um usuário específico está online? */
  isOnline(userId: string, now: number = Date.now()): boolean {
    const v = this.seen.get(userId);
    return v != null && now - v.at <= this.ttlMs;
  }

  /** Sala atual de um usuário online (ou null se offline / sem sala). */
  roomOf(userId: string, now: number = Date.now()): string | null {
    const v = this.seen.get(userId);
    return v != null && now - v.at <= this.ttlMs ? v.room : null;
  }

  /** Remove um usuário (ex.: logout explícito). */
  drop(userId: string): void {
    this.seen.delete(userId);
  }
}

/** Instância compartilhada do processo (HTTP + WS tocam a mesma presença). */
export const presence = new PresenceTracker();
