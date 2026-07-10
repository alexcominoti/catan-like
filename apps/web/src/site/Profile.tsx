import { useEffect, useState, type FormEvent } from 'react';
import { Trophy, CircleDot, TrendingUp, Flame, Award, Settings, Lock, Check, ShieldCheck, UserPlus } from 'lucide-react';
import { authClient } from '../auth/client.js';
import { validateUsername } from '../auth/username.js';
import { sendFriendRequest } from './social.js';
import { LoginGate } from './LoginGate.js';
import { useT, useLang, type Lang, type MsgKey } from '../i18n/index.js';

// PARTIDAS/VITÓRIAS/SEQUÊNCIA e "Últimas partidas" vêm de GET /api/profile/stats
// (dados REAIS do banco). Como ainda não persistimos partidas, na prática vêm
// zerados/vazios — a UI mostra o estado vazio em vez de números mockados.
// ELO e Conquistas seguem "Em breve" (ver docs/backlog.md → Perfil).
const MAP_LABEL: Record<string, MsgKey> = {
  standard: 'map.standard',
  large: 'map.large',
  huge: 'map.huge',
};

type TFn = (key: MsgKey, params?: Record<string, string | number>) => string;

interface ProfileMatch {
  won: boolean;
  points: number;
  map: string | null;
  opponents: string[];
  finishedAt: string | null;
}
interface ProfileStats {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  longestStreak: number;
  karma: number;
  gamesAbandoned: number;
  matches: ProfileMatch[];
}

/** Tempo relativo curto, no idioma atual, a partir de um ISO. */
function relativeTime(iso: string | null, t: TFn, lang: Lang): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return t('profile.time.justNow');
  if (h < 24) return t('profile.time.hoursAgo', { h });
  const d = Math.floor(h / 24);
  if (d === 1) return t('profile.time.yesterday');
  if (d < 7) return t('profile.time.daysAgo', { d });
  return new Date(iso).toLocaleDateString(lang, { day: '2-digit', month: 'short' });
}

/**
 * Perfil: SEM `username` = o próprio (sessão + edição); COM `username` = visita
 * pública de terceiro (compartilhável via `/profile/:username`, somente leitura).
 * `onOwnUsername` sincroniza a URL do App assim que o próprio username resolve
 * (útil quando "Perfil" é clicado antes da sessão carregar).
 */
export function Profile({
  username,
  onOwnUsername,
  onNeedAuth,
}: {
  username?: string;
  onOwnUsername?: (u: string) => void;
  onNeedAuth?: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const isOwn = username == null;
  const { data: session, isPending } = authClient.useSession();
  const u = session?.user as
    | (NonNullable<typeof session>['user'] & { username?: string | null; usernameChanged?: boolean | null })
    | undefined;

  // Username PRÓPRIO (e cota de troca) com override local, pois o cache de
  // sessão pode demorar a refletir a troca recém-feita.
  const [ownUsername, setOwnUsername] = useState<string>('');
  const [changed, setChanged] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!isOwn || !u) return;
    const resolved = u.username ?? u.name ?? '';
    setOwnUsername(resolved);
    setChanged(Boolean(u.usernameChanged));
    if (resolved) onOwnUsername?.(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwn, u?.username, u?.name, u?.usernameChanged]);

  // Estatísticas do PRÓPRIO perfil (vazias enquanto não há partidas persistidas).
  const [ownStats, setOwnStats] = useState<ProfileStats | null>(null);
  useEffect(() => {
    if (!isOwn || !u) return;
    let alive = true;
    void fetch('/api/profile/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ProfileStats | null) => {
        if (alive && data) setOwnStats(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isOwn, u?.id]);

  // Perfil PÚBLICO de terceiro — busca sem exigir login.
  const [publicProfile, setPublicProfile] = useState<{ username: string; stats: ProfileStats } | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);
  useEffect(() => {
    if (isOwn || !username) return;
    let alive = true;
    setPublicProfile(null);
    setPublicError(null);
    void fetch(`/api/profile/by-username/${encodeURIComponent(username)}`)
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { username?: string; stats?: ProfileStats; error?: string };
        if (!r.ok) throw new Error(data.error ?? t('profile.notFound'));
        return data as { username: string; stats: ProfileStats };
      })
      .then((data) => {
        if (alive) setPublicProfile(data);
      })
      .catch((err) => {
        if (alive) setPublicError(err instanceof Error ? err.message : t('common.unexpected'));
      });
    return () => {
      alive = false;
    };
  }, [isOwn, username, t]);

  const stats = isOwn ? ownStats : (publicProfile?.stats ?? null);

  // Adicionar amigo a partir de um perfil público (só logado e não sendo você mesmo).
  const [friendMsg, setFriendMsg] = useState<string | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const publicName = publicProfile?.username ?? username ?? '';
  const viewingSelf =
    !isOwn && Boolean(u) && (u?.username ?? u?.name ?? '').toLowerCase() === publicName.toLowerCase();
  const canAddFriend = !isOwn && Boolean(session?.user) && !viewingSelf && Boolean(publicProfile);

  async function addFriend() {
    setFriendBusy(true);
    setFriendMsg(null);
    const res = await sendFriendRequest(publicName);
    setFriendBusy(false);
    setFriendMsg(res.ok ? t('profile.friendSent') : res.error);
  }

  const winRate =
    stats && stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;
  const losses = stats ? stats.gamesPlayed - stats.gamesWon : 0;

  const display = isOwn ? (ownUsername || t('profile.playerFallback')) : (publicProfile?.username ?? username ?? t('profile.playerFallback'));
  const initial = display.charAt(0).toUpperCase();
  const joined = isOwn && u?.createdAt
    ? new Date(u.createdAt).toLocaleDateString(lang, { month: 'short', year: 'numeric' })
    : null;

  // Perfil PRÓPRIO é rota protegida (só a Home é pública); perfil público por
  // username segue acessível por link (somente leitura).
  if (isOwn && isPending) {
    return <div className="page"><p className="muted-note">{t('common.loading')}</p></div>;
  }
  if (isOwn && !session?.user) {
    return (
      <LoginGate
        title={t('profile.gate.title')}
        hint={t('profile.gate.hint')}
        onNeedAuth={onNeedAuth ?? (() => {})}
      />
    );
  }

  if (!isOwn && publicError) {
    return (
      <div className="page">
        <div className="card wr-gate">
          <h2>{publicError}</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="page profile">
      <div className="card profile-head">
        <span className="avatar">{initial}</span>
        <div className="profile-id">
          <span className="eyebrow">{t('profile.player')}</span>
          <h1>
            {display}
            {changed && (
              <span className="name-locked" title={t('profile.nameChangedTitle')}>
                <Lock size={13} /> {t('profile.nameChanged')}
              </span>
            )}
          </h1>
          <span className="muted-note">{joined ? t('profile.joined', { date: joined }) : 'Trevalis'}</span>
        </div>
        {isOwn && (
          <button className="ghost" onClick={() => setEditing(true)} disabled={!u}>
            <Settings size={15} /> {t('profile.editProfile')}
          </button>
        )}
        {canAddFriend && (
          <button className="cta" onClick={addFriend} disabled={friendBusy}>
            <UserPlus size={15} /> {friendBusy ? t('profile.sending') : t('profile.addFriend')}
          </button>
        )}
      </div>
      {friendMsg && <div className="friend-notice">{friendMsg}</div>}

      <div className="stat-row">
        {/* ELO: "Em breve" — sem sistema de rating ainda. Ver docs/backlog.md → Perfil. */}
        <div className="card stat-box">
          <span className="eyebrow stat-eyebrow"><Trophy size={14} /> ELO</span>
          <span className="soon-tag">{t('common.soon')}</span>
        </div>
        <div className="card stat-box">
          <span className="eyebrow stat-eyebrow"><CircleDot size={14} /> {t('profile.stat.games')}</span>
          <span className="stat-value">{stats?.gamesPlayed ?? 0}</span>
          <span className="muted-note">{t('profile.stat.gamesSub')}</span>
        </div>
        <div className="card stat-box">
          <span className="eyebrow stat-eyebrow"><TrendingUp size={14} /> {t('profile.stat.wins')}</span>
          <span className="stat-value">{winRate}%</span>
          <span className="muted-note">{t('profile.stat.winLoss', { w: stats?.gamesWon ?? 0, l: losses })}</span>
        </div>
        <div className="card stat-box">
          <span className="eyebrow stat-eyebrow"><Flame size={14} /> {t('profile.stat.streak')}</span>
          <span className="stat-value">{stats?.currentStreak ?? 0}</span>
          <span className="muted-note">{t('profile.stat.record', { n: stats?.longestStreak ?? 0 })}</span>
        </div>
        {/* KARMA: anti-abandono (partidas levadas até o fim). Ver karma.ts no servidor. */}
        <div className="card stat-box">
          <span className="eyebrow stat-eyebrow"><ShieldCheck size={14} /> {t('profile.stat.karma')}</span>
          <span className="stat-value">{stats?.karma ?? 100}%</span>
          <span className="muted-note">{stats?.gamesAbandoned ? t('profile.stat.abandoned', { n: stats.gamesAbandoned }) : t('profile.stat.noAbandons')}</span>
        </div>
      </div>

      <div className="profile-cols">
        <div className="card">
          <div className="card-head">
            <h2>{t('profile.recentMatches')}</h2>
          </div>
          {!stats || stats.matches.length === 0 ? (
            <p className="muted-note match-empty">{t('profile.noMatches')}</p>
          ) : (
            stats.matches.map((m, i) => (
              <div key={i} className="match-row">
                <span className={`dot ${m.won ? 'win' : 'loss'}`} />
                <div className="match-info">
                  <b>{m.won ? t('profile.win') : t('profile.loss')}</b> · {m.points} pts · {m.map ? (MAP_LABEL[m.map] ? t(MAP_LABEL[m.map]!) : m.map) : '—'}
                  <small>{m.opponents.length ? `vs ${m.opponents.join(', ')}` : t('profile.noOpponents')}</small>
                </div>
                <div className="match-delta">
                  <small>{relativeTime(m.finishedAt, t, lang)}</small>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Conquistas: "Em breve" — sem catálogo/desbloqueio. Ver docs/backlog.md → Perfil. */}
        <div className="card">
          <h2>{t('profile.achievements')}</h2>
          <div className="soon-block">
            <Award size={26} className="ic-primary" />
            <span className="soon-tag">{t('common.soon')}</span>
            <p className="muted-note">{t('profile.achievementsSoon')}</p>
          </div>
        </div>
      </div>

      {isOwn && editing && u && (
        <EditUsernameModal
          current={ownUsername}
          alreadyChanged={changed}
          onClose={() => setEditing(false)}
          onSaved={(name) => {
            setOwnUsername(name);
            setChanged(true);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

/** Modal de edição do username — alteração ÚNICA (item 4). */
function EditUsernameModal({
  current,
  alreadyChanged,
  onClose,
  onSaved,
}: {
  current: string;
  alreadyChanged: boolean;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/profile/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: value.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { username?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? t('profile.edit.failName'));
      onSaved(data.username ?? value.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unexpected'));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (alreadyChanged) return;
    const vErr = validateUsername(value);
    if (vErr) {
      setError(vErr);
      return;
    }
    setError(null);
    setConfirming(true);
  }

  return (
    <div className="pf-modal-overlay" onClick={onClose}>
      <form className="pf-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{t('profile.editProfile')}</h2>

        {error && <div className="auth-error">{error}</div>}

        <label className="pf-field">
          {t('auth.field.username')}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={alreadyChanged || busy}
            minLength={4}
            maxLength={20}
            autoFocus
          />
          <small className="auth-hint">{t('auth.field.usernameHint')}</small>
        </label>

        {alreadyChanged ? (
          <div className="pf-locked-note">
            <Lock size={14} /> {t('profile.edit.locked')}
          </div>
        ) : confirming ? (
          <div className="pf-confirm">
            <p>{t('profile.edit.confirm')}</p>
            <div className="pf-actions">
              <button type="button" className="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button type="button" className="cta" onClick={save} disabled={busy}>
                <Check size={15} /> {busy ? t('profile.edit.saving') : t('profile.edit.confirmYes')}
              </button>
            </div>
          </div>
        ) : (
          <div className="pf-actions">
            <button type="button" className="ghost" onClick={onClose}>{t('common.close')}</button>
            <button type="submit" className="cta">{t('profile.edit.changeName')}</button>
          </div>
        )}
      </form>
    </div>
  );
}
