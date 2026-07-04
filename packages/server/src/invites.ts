/**
 * Convites de sala (Tier 2, parte do painel de notificações) — em memória (por
 * processo), efêmeros: um jogador convida um amigo para a sua mesa; o amigo vê o
 * convite no sino e entra pelo link. Não sobrevive a restart (é só um "toque").
 */

export interface Invite {
  fromUserId: string;
  fromUsername: string;
  code: string;
  at: number;
}

export class InviteStore {
  private readonly byUser = new Map<string, Invite[]>();
  private readonly ttlMs: number;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  /** Registra um convite para `toUserId` (substitui um anterior do mesmo par/sala). */
  add(toUserId: string, from: { userId: string; username: string }, code: string, now = Date.now()): void {
    const list = (this.byUser.get(toUserId) ?? []).filter(
      (i) => !(i.fromUserId === from.userId && i.code === code),
    );
    list.push({ fromUserId: from.userId, fromUsername: from.username, code, at: now });
    this.byUser.set(toUserId, list);
  }

  /** Convites vigentes de um usuário (poda os expirados). */
  listFor(userId: string, now = Date.now()): Invite[] {
    const list = (this.byUser.get(userId) ?? []).filter((i) => now - i.at <= this.ttlMs);
    this.byUser.set(userId, list);
    return list;
  }

  /** Remove um convite (aceito ou dispensado). */
  remove(userId: string, code: string): void {
    const list = (this.byUser.get(userId) ?? []).filter((i) => i.code !== code);
    this.byUser.set(userId, list);
  }
}

/** Instância compartilhada do processo. */
export const invites = new InviteStore();
