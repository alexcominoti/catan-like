import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, CheckCheck, X, Play, Circle, UserPlus, LogIn } from 'lucide-react';
import {
  acceptFriend,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removeFriend,
  type AppNotification,
  type Notifications,
} from './social.js';
import { useT, useLang, type Lang } from '../i18n/index.js';

const POLL_MS = 20_000;

const EMPTY: Notifications = { notifications: [], onlineFriends: [], rejoin: [], unreadCount: 0 };

/** Tempo relativo curto ("há 5 min", "ontem") a partir de um ISO, no idioma atual. */
function timeAgo(iso: string, lang: Lang, nowLabel: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return nowLabel;
  const m = Math.round(s / 60);
  if (m < 60) return rtf.format(-m, 'minute');
  const h = Math.round(m / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  return rtf.format(-Math.round(h / 24), 'day');
}

/**
 * Sino de notificações (Tier 2): feed PERSISTIDO (convites de sala, pedidos de
 * amizade e "fulano aceitou") com estado lido/não-lido, data e expiração de 30
 * dias — servido por `/api/notifications`. As seções "Reconectar" e "Amigos
 * online" continuam sendo estados AO VIVO (derivados, não persistidos).
 * `onEnterRoom` navega para a sala.
 */
export function NotificationsBell({ onEnterRoom }: { onEnterRoom: (code: string) => void }) {
  const t = useT();
  const [data, setData] = useState<Notifications>(EMPTY);
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

  const readOne = (id: string) => void markNotificationRead(id).then(refresh);
  const readAll = () => void markAllNotificationsRead().then(refresh);

  const enterInvite = (n: AppNotification) => {
    void markNotificationRead(n.id);
    setOpen(false);
    if (n.data?.code) onEnterRoom(n.data.code);
  };

  const hasAny = data.notifications.length > 0 || data.rejoin.length > 0 || data.onlineFriends.length > 0;

  return (
    <div className="notif" ref={ref}>
      <button className="notif-bell" aria-label={t('notif.title')} onClick={() => { setOpen((o) => !o); refresh(); }}>
        <Bell size={17} />
        {data.unreadCount > 0 && <span className="notif-badge">{data.unreadCount > 9 ? '9+' : data.unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <span>{t('notif.title')}</span>
            {data.unreadCount > 0 && (
              <button className="notif-readall" onClick={readAll}><CheckCheck size={12} /> {t('notif.markAllRead')}</button>
            )}
          </div>

          {/* Reconectar (ao vivo — vale enquanto a sala existir e der para voltar). */}
          {data.rejoin.length > 0 && (
            <div className="notif-section notif-rejoin">
              <span className="notif-label"><LogIn size={12} /> {t('notif.reconnect')}</span>
              {data.rejoin.map((r) => (
                <div key={r.code} className="notif-row">
                  <span className="notif-name">🎮 {r.name} <small className="muted-note">{t('notif.inProgress')}</small></span>
                  <button className="cta sm" onClick={() => { setOpen(false); onEnterRoom(r.code); }}><LogIn size={13} /> {t('notif.back')}</button>
                </div>
              ))}
            </div>
          )}

          {/* Feed persistido (lida/não-lida, datado). */}
          {data.notifications.length > 0 && (
            <div className="notif-section">
              {data.notifications.map((n) => (
                <NotifRow
                  key={n.id}
                  n={n}
                  onRead={readOne}
                  onEnter={enterInvite}
                  onAccept={(x) => x.actorId && void acceptFriend(x.actorId).then(refresh)}
                  onReject={(x) => x.actorId && void removeFriend(x.actorId).then(refresh)}
                />
              ))}
            </div>
          )}

          {data.onlineFriends.length > 0 && (
            <div className="notif-section">
              <span className="notif-label"><Circle size={9} className="presence-dot on" fill="currentColor" /> {t('notif.onlineFriends')}</span>
              {data.onlineFriends.map((f) => (
                <div key={f.userId} className="notif-row">
                  <span className="notif-name">@{f.username} <small className="muted-note">{f.room ? t('notif.inGame') : t('notif.online')}</small></span>
                  {f.room && <button className="cta sm" onClick={() => { setOpen(false); onEnterRoom(f.room!); }}><Play size={13} /></button>}
                </div>
              ))}
            </div>
          )}

          {!hasAny && <div className="notif-empty">{t('notif.empty')}</div>}
        </div>
      )}
    </div>
  );
}

/** Uma linha do feed persistido. Aparência muda por tipo; `unread` deixa em destaque. */
function NotifRow({
  n,
  onRead,
  onEnter,
  onAccept,
  onReject,
}: {
  n: AppNotification;
  onRead: (id: string) => void;
  onEnter: (n: AppNotification) => void;
  onAccept: (n: AppNotification) => void;
  onReject: (n: AppNotification) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const who = n.actorUsername ? `@${n.actorUsername}` : t('notif.someone');
  const cls = `notif-row notif-item${n.read ? '' : ' unread'}`;
  const dot = !n.read && <span className="notif-unread-dot" aria-hidden />;
  const when = <small className="muted-note">{timeAgo(n.createdAt, lang, t('time.now'))}</small>;

  if (n.type === 'room_invite') {
    return (
      <div className={cls}>
        <span className="notif-name">{dot}<Play size={13} /> {t('notif.roomInvite', { who })} {when}</span>
        <div className="notif-actions">
          <button className="cta sm" onClick={() => onEnter(n)}>{t('notif.enter')}</button>
          <button className="ghost sm" aria-label={t('notif.dismiss')} onClick={() => onRead(n.id)}><X size={13} /></button>
        </div>
      </div>
    );
  }

  if (n.type === 'friend_request') {
    return (
      <div className={cls}>
        <span className="notif-name">{dot}<UserPlus size={13} /> {t('notif.friendRequest', { who })} {when}</span>
        <div className="notif-actions">
          <button className="cta sm" aria-label={t('notif.accept')} onClick={() => onAccept(n)}><Check size={13} /></button>
          <button className="ghost sm" aria-label={t('notif.reject')} onClick={() => onReject(n)}><X size={13} /></button>
        </div>
      </div>
    );
  }

  // friend_accepted — informativo; clicar marca como lido.
  return (
    <button className={`${cls} as-button`} onClick={() => onRead(n.id)}>
      <span className="notif-name">{dot}<Check size={13} /> {t('notif.friendAccepted', { who })} {when}</span>
    </button>
  );
}
