import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { UserPlus, Check, X, Circle, Play, Eye, Users } from 'lucide-react';
import { authClient } from '../auth/client.js';
import { LoginGate } from './LoginGate.js';
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
    return <div className="page"><p className="muted-note">Carregando…</p></div>;
  }
  if (!loggedIn) {
    return (
      <LoginGate
        title="Entre para ver seus amigos"
        hint="Você precisa de uma conta para adicionar e acompanhar amigos."
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
      setNotice(`Pedido enviado para @${username}.`);
      refresh();
    } else {
      setError(res.error);
    }
  }

  async function act(fn: Promise<{ ok: boolean; error?: string }>) {
    const res = await fn;
    if (!res.ok && 'error' in res) setError(res.error ?? 'Erro inesperado.');
    refresh();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">SOCIAL</span>
          <h1>Amigos.</h1>
        </div>
      </div>

      <div className="card friend-add">
        <form onSubmit={submit}>
          <label className="pf-field">
            Adicionar por nome de usuário
            <div className="friend-add-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex.: colono42"
                maxLength={20}
                aria-label="Nome de usuário do amigo"
              />
              <button type="submit" className="cta" disabled={busy || !name.trim()}>
                <UserPlus size={15} /> {busy ? 'Enviando…' : 'Adicionar'}
              </button>
            </div>
          </label>
        </form>
        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="friend-notice">{notice}</div>}
      </div>

      {data.incoming.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Pedidos recebidos</h2></div>
          {data.incoming.map((p) => (
            <div key={p.userId} className="friend-row">
              <span className="friend-name">@{p.username}</span>
              <div className="friend-actions">
                <button className="cta sm" onClick={() => act(acceptFriend(p.userId))}><Check size={14} /> Aceitar</button>
                <button className="ghost sm" onClick={() => act(removeFriend(p.userId))}><X size={14} /> Recusar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Meus amigos {data.friends.length > 0 && <small className="muted-note">({data.friends.length})</small>}</h2>
        </div>
        {data.friends.length === 0 ? (
          <div className="soon-block">
            <Users size={26} className="ic-primary" />
            <p className="muted-note">Você ainda não tem amigos. Adicione alguém pelo nome de usuário acima!</p>
          </div>
        ) : (
          data.friends.map((f) => (
            <div key={f.userId} className="friend-row">
              <span className="friend-name">
                <Circle size={9} className={`presence-dot ${f.online ? 'on' : 'off'}`} fill="currentColor" />
                @{f.username}
                <small className="muted-note">{f.online ? (f.room ? 'em partida' : 'online') : 'offline'}</small>
              </span>
              <div className="friend-actions">
                {confirmRemove === f.userId ? (
                  <>
                    <span className="muted-note">Desfazer amizade?</span>
                    <button
                      className="cta sm danger"
                      onClick={() => { setConfirmRemove(null); void act(removeFriend(f.userId)); }}
                    >
                      <Check size={14} /> Remover
                    </button>
                    <button className="ghost sm" onClick={() => setConfirmRemove(null)}>Cancelar</button>
                  </>
                ) : (
                  <>
                    {f.online && f.room && (
                      <button className="cta sm" onClick={() => onEnterRoom(f.room!)}>
                        <Play size={14} /> Entrar
                      </button>
                    )}
                    {f.online && !f.room && (
                      <button className="ghost sm" disabled title="Online, fora de uma sala"><Eye size={14} /> Online</button>
                    )}
                    <button
                      className="ghost sm danger"
                      onClick={() => setConfirmRemove(f.userId)}
                      title="Desfazer amizade"
                      aria-label={`Desfazer amizade com @${f.username}`}
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
          <div className="card-head"><h2>Pedidos enviados</h2></div>
          {data.outgoing.map((p) => (
            <div key={p.userId} className="friend-row">
              <span className="friend-name muted-note">@{p.username} · aguardando</span>
              <div className="friend-actions">
                <button className="ghost sm" onClick={() => act(removeFriend(p.userId))}><X size={14} /> Cancelar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
