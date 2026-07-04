import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, X, Play, Circle, UserPlus } from 'lucide-react';
import {
  acceptFriend,
  dismissInvite,
  getNotifications,
  removeFriend,
  type Notifications,
} from './social.js';

const POLL_MS = 20_000;

/**
 * Sino de notificações (Tier 2, Colonist v215): pedidos de amizade, convites de
 * sala e amigos online — num painel suspenso no header. `onEnterRoom` navega para
 * a sala (aceitar convite / entrar no jogo de um amigo).
 */
export function NotificationsBell({ onEnterRoom }: { onEnterRoom: (code: string) => void }) {
  const [data, setData] = useState<Notifications>({ friendRequests: [], invites: [], onlineFriends: [], count: 0 });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    void getNotifications().then(setData);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const enterInvite = (code: string) => {
    void dismissInvite(code);
    setOpen(false);
    onEnterRoom(code);
  };

  const hasAny = data.friendRequests.length > 0 || data.invites.length > 0 || data.onlineFriends.length > 0;

  return (
    <div className="notif" ref={ref}>
      <button className="notif-bell" aria-label="Notificações" onClick={() => { setOpen((o) => !o); refresh(); }}>
        <Bell size={17} />
        {data.count > 0 && <span className="notif-badge">{data.count > 9 ? '9+' : data.count}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">Notificações</div>

          {data.friendRequests.length > 0 && (
            <div className="notif-section">
              <span className="notif-label"><UserPlus size={12} /> Pedidos de amizade</span>
              {data.friendRequests.map((p) => (
                <div key={p.userId} className="notif-row">
                  <span className="notif-name">@{p.username}</span>
                  <div className="notif-actions">
                    <button className="cta sm" onClick={() => void acceptFriend(p.userId).then(refresh)}><Check size={13} /></button>
                    <button className="ghost sm" onClick={() => void removeFriend(p.userId).then(refresh)}><X size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.invites.length > 0 && (
            <div className="notif-section">
              <span className="notif-label"><Play size={12} /> Convites de sala</span>
              {data.invites.map((inv) => (
                <div key={`${inv.fromUserId}:${inv.code}`} className="notif-row">
                  <span className="notif-name">@{inv.fromUsername} te chamou</span>
                  <div className="notif-actions">
                    <button className="cta sm" onClick={() => enterInvite(inv.code)}>Entrar</button>
                    <button className="ghost sm" onClick={() => void dismissInvite(inv.code).then(refresh)}><X size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.onlineFriends.length > 0 && (
            <div className="notif-section">
              <span className="notif-label"><Circle size={9} className="presence-dot on" fill="currentColor" /> Amigos online</span>
              {data.onlineFriends.map((f) => (
                <div key={f.userId} className="notif-row">
                  <span className="notif-name">@{f.username} <small className="muted-note">{f.room ? 'em partida' : 'online'}</small></span>
                  {f.room && <button className="cta sm" onClick={() => { setOpen(false); onEnterRoom(f.room!); }}><Play size={13} /></button>}
                </div>
              ))}
            </div>
          )}

          {!hasAny && <div className="notif-empty">Sem novidades por aqui.</div>}
        </div>
      )}
    </div>
  );
}
