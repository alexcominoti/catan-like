import { useEffect, useState, type FormEvent } from 'react';
import { Trophy, CircleDot, TrendingUp, Flame, Award, Settings, Lock, Check } from 'lucide-react';
import { authClient } from '../auth/client.js';
import { validateUsername } from '../auth/username.js';

// PARTIDAS/VITÓRIAS/SEQUÊNCIA e "Últimas partidas" vêm de GET /api/profile/stats
// (dados REAIS do banco). Como ainda não persistimos partidas, na prática vêm
// zerados/vazios — a UI mostra o estado vazio em vez de números mockados.
// ELO e Conquistas seguem "Em breve" (ver docs/backlog.md → Perfil).
const MAP_LABEL: Record<string, string> = {
  standard: 'Clássico (3–4)',
  large: 'Grande (5–6)',
  huge: 'Enorme (7–8)',
};

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
  matches: ProfileMatch[];
}

/** Tempo relativo curto (pt-BR) a partir de um ISO. */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'agora há pouco';
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/**
 * Perfil: SEM `username` = o próprio (sessão + edição); COM `username` = visita
 * pública de terceiro (compartilhável via `/profile/:username`, somente leitura).
 * `onOwnUsername` sincroniza a URL do App assim que o próprio username resolve
 * (útil quando "Perfil" é clicado antes da sessão carregar).
 */
export function Profile({ username, onOwnUsername }: { username?: string; onOwnUsername?: (u: string) => void }) {
  const isOwn = username == null;
  const { data: session } = authClient.useSession();
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
        if (!r.ok) throw new Error(data.error ?? 'Usuário não encontrado.');
        return data as { username: string; stats: ProfileStats };
      })
      .then((data) => {
        if (alive) setPublicProfile(data);
      })
      .catch((err) => {
        if (alive) setPublicError(err instanceof Error ? err.message : 'Erro inesperado.');
      });
    return () => {
      alive = false;
    };
  }, [isOwn, username]);

  const stats = isOwn ? ownStats : (publicProfile?.stats ?? null);

  const winRate =
    stats && stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;
  const losses = stats ? stats.gamesPlayed - stats.gamesWon : 0;

  const display = isOwn ? (ownUsername || 'jogador') : (publicProfile?.username ?? username ?? 'jogador');
  const initial = display.charAt(0).toUpperCase();
  const joined = isOwn && u?.createdAt
    ? new Date(u.createdAt).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
    : null;

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
          <span className="eyebrow">JOGADOR</span>
          <h1>
            {display}
            {changed && (
              <span className="name-locked" title="Você já alterou seu nome de usuário.">
                <Lock size={13} /> nome já alterado
              </span>
            )}
          </h1>
          <span className="muted-note">{joined ? `Entrou em ${joined}` : 'Trevalis'}</span>
        </div>
        {isOwn && (
          <button className="ghost" onClick={() => setEditing(true)} disabled={!u}>
            <Settings size={15} /> Editar perfil
          </button>
        )}
      </div>

      <div className="stat-row">
        {/* ELO: "Em breve" — sem sistema de rating ainda. Ver docs/backlog.md → Perfil. */}
        <div className="card stat-box">
          <span className="eyebrow stat-eyebrow"><Trophy size={14} /> ELO</span>
          <span className="soon-tag">Em breve</span>
        </div>
        <div className="card stat-box">
          <span className="eyebrow stat-eyebrow"><CircleDot size={14} /> PARTIDAS</span>
          <span className="stat-value">{stats?.gamesPlayed ?? 0}</span>
          <span className="muted-note">total jogadas</span>
        </div>
        <div className="card stat-box">
          <span className="eyebrow stat-eyebrow"><TrendingUp size={14} /> VITÓRIAS</span>
          <span className="stat-value">{winRate}%</span>
          <span className="muted-note">{stats?.gamesWon ?? 0}V / {losses}D</span>
        </div>
        <div className="card stat-box">
          <span className="eyebrow stat-eyebrow"><Flame size={14} /> SEQUÊNCIA</span>
          <span className="stat-value">{stats?.currentStreak ?? 0}</span>
          <span className="muted-note">recorde: {stats?.longestStreak ?? 0}</span>
        </div>
      </div>

      <div className="profile-cols">
        <div className="card">
          <div className="card-head">
            <h2>Últimas partidas</h2>
          </div>
          {!stats || stats.matches.length === 0 ? (
            <p className="muted-note match-empty">Sem partidas ainda. Jogue uma para começar seu histórico!</p>
          ) : (
            stats.matches.map((m, i) => (
              <div key={i} className="match-row">
                <span className={`dot ${m.won ? 'win' : 'loss'}`} />
                <div className="match-info">
                  <b>{m.won ? 'Vitória' : 'Derrota'}</b> · {m.points} pts · {m.map ? (MAP_LABEL[m.map] ?? m.map) : '—'}
                  <small>{m.opponents.length ? `vs ${m.opponents.join(', ')}` : 'sem oponentes'}</small>
                </div>
                <div className="match-delta">
                  <small>{relativeTime(m.finishedAt)}</small>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Conquistas: "Em breve" — sem catálogo/desbloqueio. Ver docs/backlog.md → Perfil. */}
        <div className="card">
          <h2>Conquistas</h2>
          <div className="soon-block">
            <Award size={26} className="ic-primary" />
            <span className="soon-tag">Em breve</span>
            <p className="muted-note">Catálogo de conquistas a caminho.</p>
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
      if (!res.ok) throw new Error(data.error ?? 'Falha ao alterar o nome.');
      onSaved(data.username ?? value.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
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
        <h2>Editar perfil</h2>

        {error && <div className="auth-error">{error}</div>}

        <label className="pf-field">
          Nome de usuário
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={alreadyChanged || busy}
            minLength={4}
            maxLength={20}
            autoFocus
          />
          <small className="auth-hint">4–20 caracteres; letras, números, ponto e hífen.</small>
        </label>

        {alreadyChanged ? (
          <div className="pf-locked-note">
            <Lock size={14} /> Você já usou sua alteração de nome — o campo está somente leitura.
          </div>
        ) : confirming ? (
          <div className="pf-confirm">
            <p>Você só pode alterar seu nome uma vez. Tem certeza?</p>
            <div className="pf-actions">
              <button type="button" className="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancelar
              </button>
              <button type="button" className="cta" onClick={save} disabled={busy}>
                <Check size={15} /> {busy ? 'Salvando…' : 'Sim, alterar'}
              </button>
            </div>
          </div>
        ) : (
          <div className="pf-actions">
            <button type="button" className="ghost" onClick={onClose}>Fechar</button>
            <button type="submit" className="cta">Alterar nome</button>
          </div>
        )}
      </form>
    </div>
  );
}
