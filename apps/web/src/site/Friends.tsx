import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { UserPlus, Check, X, Circle, Play, Eye, Users } from 'lucide-react';
import { authClient } from '../auth/client.js';
import { LoginGate } from './LoginGate.js';
import { useT } from '../i18n/index.js';
import {
  acceptFriend,
  getFriends,
  removeFriend,
  sendFriendRequest,
  type FriendsPayload,
} from './social.js';

/** Frequência de atualização da lista (status online muda com o tempo). */
const REFRESH_MS = 15_000;

/**
 * Página de amigos (Tier 1, item 2): adicionar por username, aceitar/recusar
 * pedidos e ver quem está online — com atalho para entrar/assistir a partida de
 * um amigo. `onEnterRoom` navega para a sala do amigo (link `/room/<code>`).
 */
export function Friends({
  onEnterRoom,
  onNeedAuth,
}: {
  onEnterRoom: (code: string) => void;
  onNeedAuth: () => void;
}) {
  const t = useT();
  const { data: session, isPending } = authClient.useSession();
  const loggedIn = Boolean(session?.user);

  const [data, setData] = useState<FriendsPayload>({ friends: [], incoming: [], outgoing: [], blocked: [] });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** userId do amigo cuja remoção aguarda confirmação inline (null = nenhum). */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void getFriends().then(setData);
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [loggedIn, refresh]);

  if (isPending) {
    return <div className="page"><p className="muted-note">{t('common.loading')}</p></div>;
  }
  if (!loggedIn) {
    return (
      <LoginGate
        title={t('friends.gate.title')}
        hint={t('friends.gate.hint')}
        onNeedAuth={onNeedAuth}
      />
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const username = name.trim();
    if (!username) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await sendFriendRequest(username);
    setBusy(false);
    if (res.ok) {
      setName('');
      setNotice(t('friends.requestSent', { username }));
      refresh();
    } else {
      setError(res.error);
    }
  }

  async function act(fn: Promise<{ ok: boolean; error?: string }>) {
    const res = await fn;
    if (!res.ok && 'error' in res) setError(res.error ?? t('common.unexpected'));
    refresh();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{t('friends.eyebrow')}</span>
          <h1>{t('friends.title')}</h1>
        </div>
      </div>

      <div className="card friend-add">
        <form onSubmit={submit}>
          <label className="pf-field">
            {t('friends.addByUsername')}
            <div className="friend-add-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('friends.addPlaceholder')}
                maxLength={20}
                aria-label={t('friends.addAria')}
              />
              <button type="submit" className="cta" disabled={busy || !name.trim()}>
                <UserPlus size={15} /> {busy ? t('friends.sending') : t('friends.add')}
              </button>
            </div>
          </label>
        </form>
        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="friend-notice">{notice}</div>}
      </div>

      {data.incoming.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>{t('friends.incoming')}</h2></div>
          {data.incoming.map((p) => (
            <div key={p.userId} className="friend-row">
              <span className="friend-name">@{p.username}</span>
              <div className="friend-actions">
                <button className="cta sm" onClick={() => act(acceptFriend(p.userId))}><Check size={14} /> {t('friends.accept')}</button>
                <button className="ghost sm" onClick={() => act(removeFriend(p.userId))}><X size={14} /> {t('friends.decline')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>{t('friends.myFriends')} {data.friends.length > 0 && <small className="muted-note">({data.friends.length})</small>}</h2>
        </div>
        {data.friends.length === 0 ? (
          <div className="soon-block">
            <Users size={26} className="ic-primary" />
            <p className="muted-note">{t('friends.empty')}</p>
          </div>
        ) : (
          data.friends.map((f) => (
            <div key={f.userId} className="friend-row">
              <span className="friend-name">
                <Circle size={9} className={`presence-dot ${f.online ? 'on' : 'off'}`} fill="currentColor" />
                @{f.username}
                <small className="muted-note">{f.online ? (f.room ? t('friends.inGame') : t('friends.online')) : t('friends.offline')}</small>
              </span>
              <div className="friend-actions">
                {confirmRemove === f.userId ? (
                  <>
                    <span className="muted-note">{t('friends.removeConfirm')}</span>
                    <button
                      className="cta sm danger"
                      onClick={() => { setConfirmRemove(null); void act(removeFriend(f.userId)); }}
                    >
                      <Check size={14} /> {t('friends.remove')}
                    </button>
                    <button className="ghost sm" onClick={() => setConfirmRemove(null)}>{t('common.cancel')}</button>
                  </>
                ) : (
                  <>
                    {f.online && f.room && (
                      <button className="cta sm" onClick={() => onEnterRoom(f.room!)}>
                        <Play size={14} /> {t('friends.enter')}
                      </button>
                    )}
                    {f.online && !f.room && (
                      <button className="ghost sm" disabled title={t('friends.onlineTitle')}><Eye size={14} /> {t('friends.onlineBtn')}</button>
                    )}
                    <button
                      className="ghost sm danger"
                      onClick={() => setConfirmRemove(f.userId)}
                      title={t('friends.removeTitle')}
                      aria-label={t('friends.removeAria', { username: f.username })}
                    >
                      <X size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {data.outgoing.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>{t('friends.outgoing')}</h2></div>
          {data.outgoing.map((p) => (
            <div key={p.userId} className="friend-row">
              <span className="friend-name muted-note">@{p.username} · {t('friends.waiting')}</span>
              <div className="friend-actions">
                <button className="ghost sm" onClick={() => act(removeFriend(p.userId))}><X size={14} /> {t('common.cancel')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
