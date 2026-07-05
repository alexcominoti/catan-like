import { useCallback, useEffect, useState } from 'react';
import { UserPlus, UserCheck, Clock, Ban, ExternalLink, Check } from 'lucide-react';
import {
  acceptFriend,
  blockUser,
  getFriends,
  removeFriend,
  sendFriendRequest,
  unblockUser,
  type FriendsPayload,
} from './social.js';

const EMPTY: FriendsPayload = { friends: [], incoming: [], outgoing: [], blocked: [] };

export type Relation = 'none' | 'outgoing' | 'incoming' | 'friends' | 'blocked';

/**
 * Minhas relações (amigos/pendentes/bloqueados) + como consultá-las por username.
 * Compartilhado pelo menu de jogador (partida, sala, fim de jogo) e pelo filtro de
 * chat (esconder mensagens de bloqueados).
 */
export function useRelationships() {
  const [data, setData] = useState<FriendsPayload>(EMPTY);
  const refresh = useCallback(() => { void getFriends().then(setData); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const blockedNames = new Set(data.blocked.map((b) => b.username.toLowerCase()));
  return { data, refresh, blockedNames };
}

/** Estado da relação com um username (+ userId quando há uma aresta). */
export function relationOf(data: FriendsPayload, username: string): { state: Relation; userId?: string } {
  const norm = username.toLowerCase();
  const find = (list: { userId: string; username: string }[]) => list.find((x) => x.username.toLowerCase() === norm);
  const b = find(data.blocked); if (b) return { state: 'blocked', userId: b.userId };
  const f = find(data.friends); if (f) return { state: 'friends', userId: f.userId };
  const o = find(data.outgoing); if (o) return { state: 'outgoing', userId: o.userId };
  const i = find(data.incoming); if (i) return { state: 'incoming', userId: i.userId };
  return { state: 'none' };
}

/**
 * Menu de contexto de um jogador (ao clicar no nome): ver perfil (nova aba),
 * adicionar/pendente/remover amigo e bloquear/desbloquear. Posicionado em (x,y).
 */
export function PlayerMenu({
  username, data, x, y, onAction, onClose,
}: {
  username: string;
  data: FriendsPayload;
  x: number;
  y: number;
  /** Chamado após uma ação de rede bem-sucedida (o pai deve dar refresh). */
  onAction: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const rel = relationOf(data, username);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!(e.target as HTMLElement)?.closest('.pmenu')) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    // Espera um tick para não capturar o mesmo clique que abriu o menu.
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function run(fn: () => Promise<{ ok: boolean }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) { onAction(); onClose(); }
  }

  const left = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 400) - 214);
  const top = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 600) - 190);

  return (
    <div className="pmenu" style={{ left, top }}>
      <div className="pmenu-head">@{username}</div>

      <button className="pmenu-item" onClick={() => { window.open(`/profile/${encodeURIComponent(username)}`, '_blank', 'noopener'); onClose(); }}>
        <ExternalLink size={14} /> Ver perfil <span className="pmenu-hint">nova aba</span>
      </button>

      {rel.state !== 'blocked' && (
        <>
          {rel.state === 'none' && (
            <button className="pmenu-item" disabled={busy} onClick={() => run(() => sendFriendRequest(username))}>
              <UserPlus size={14} /> Adicionar amigo
            </button>
          )}
          {rel.state === 'outgoing' && (
            <button className="pmenu-item" disabled={busy} onClick={() => run(() => removeFriend(rel.userId!))}>
              <Clock size={14} /> Pedido pendente <span className="pmenu-hint">cancelar</span>
            </button>
          )}
          {rel.state === 'incoming' && (
            <button className="pmenu-item" disabled={busy} onClick={() => run(() => acceptFriend(rel.userId!))}>
              <Check size={14} /> Aceitar pedido
            </button>
          )}
          {rel.state === 'friends' && (
            <button className="pmenu-item" disabled={busy} onClick={() => run(() => removeFriend(rel.userId!))}>
              <UserCheck size={14} /> Amigos <span className="pmenu-hint">remover</span>
            </button>
          )}
        </>
      )}

      {rel.state === 'blocked' ? (
        <button className="pmenu-item danger" disabled={busy} onClick={() => run(() => unblockUser(rel.userId!))}>
          <Ban size={14} /> Desbloquear
        </button>
      ) : (
        <button className="pmenu-item danger" disabled={busy} onClick={() => run(() => blockUser(username))}>
          <Ban size={14} /> Bloquear
        </button>
      )}
    </div>
  );
}
