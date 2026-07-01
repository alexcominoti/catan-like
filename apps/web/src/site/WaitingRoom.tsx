import { useEffect, useRef, useState } from 'react';
import { Copy, Check, Crown, Lock, Play, ArrowLeft, Users } from 'lucide-react';
import { authClient } from '../auth/client.js';
import { PLAYER_FILL, PLAYER_LABEL } from '../game/theme.js';
import type { PlayerColor } from '@trevalis/engine';
import type { GameConfig } from '../ui/Lobby.js';
import { getRoomApi, joinRoomApi, roomLink, startRoomApi, type RoomView } from './rooms.js';

const MAP_LABEL: Record<string, string> = {
  standard: 'Clássico (3–4)',
  large: 'Grande (5–6)',
  huge: 'Enorme (7–8)',
};

/**
 * Sala de espera (item 2). Entra (ou reentra) na sala pelo código, exige login,
 * mostra o link único compartilhável e os jogadores presentes.
 *
 * Escopo atual = METADADOS: o início da partida ainda roda LOCAL (no cliente do
 * anfitrião). O co-jogo ao vivo (vários clientes na mesma partida via WS) está no
 * backlog — ver docs/backlog.md → Multiplayer.
 */
export function WaitingRoom({
  code,
  localConfig,
  onStartGame,
  onLeave,
  onNeedAuth,
}: {
  code: string;
  localConfig: GameConfig | null;
  onStartGame: (cfg: GameConfig) => void;
  onLeave: () => void;
  onNeedAuth: () => void;
}) {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user;

  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const joined = useRef(false);

  // Entrada (idempotente) ao montar, quando autenticado.
  useEffect(() => {
    if (!user || joined.current) return;
    joined.current = true;
    void joinRoomApi(code).then((r) => {
      if (r.ok) setRoom(r.room);
      else setError(r.error);
    });
  }, [user, code]);

  // Atualiza a lista de jogadores periodicamente (presença "quase ao vivo").
  useEffect(() => {
    if (!user || error) return;
    const id = setInterval(() => {
      void getRoomApi(code).then((r) => {
        if (r.ok) setRoom(r.room);
      });
    }, 4000);
    return () => clearInterval(id);
  }, [user, code, error]);

  function copy() {
    void navigator.clipboard?.writeText(roomLink(code)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  async function start() {
    if (!localConfig) return;
    setStarting(true);
    await startRoomApi(code); // marca in_progress (sai da listagem)
    onStartGame(localConfig);
  }

  // --- estados de borda ---
  if (isPending) {
    return <div className="page"><p className="muted-note">Carregando…</p></div>;
  }
  if (!user) {
    return (
      <div className="page">
        <div className="card wr-gate">
          <Lock size={26} className="ic-primary" />
          <h2>Entre para acessar a sala</h2>
          <p className="muted-note">Você precisa de uma conta para entrar em uma sala.</p>
          <button className="cta" onClick={onNeedAuth}>Entrar / criar conta</button>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <div className="card wr-gate">
          <h2>{error}</h2>
          <button className="ghost" onClick={onLeave}><ArrowLeft size={15} /> Voltar ao lobby</button>
        </div>
      </div>
    );
  }
  if (!room) {
    return <div className="page"><p className="muted-note">Entrando na sala…</p></div>;
  }

  const canStart = room.isHost && localConfig != null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="back-link" onClick={onLeave}><ArrowLeft size={15} /> Voltar ao lobby</button>
          <span className="eyebrow">SALA DE ESPERA</span>
          <h1>{room.name} {room.isPrivate && <Lock size={18} className="ic-muted" />}</h1>
        </div>
      </div>

      <div className="card wr-link">
        <label>Link da sala — compartilhe para convidar</label>
        <div className="wr-link-row">
          <input readOnly value={roomLink(code)} onFocus={(e) => e.target.select()} />
          <button className="cta" onClick={copy}>
            {copied ? <><Check size={15} /> Copiado!</> : <><Copy size={15} /> Copiar link</>}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="su-h">
          <Users size={18} className="ic-primary" /> Jogadores
          <span className="su-count">{room.players.length}/{room.maxPlayers}</span>
        </h2>
        <p className="muted-note">Mapa: {MAP_LABEL[room.boardLayout] ?? room.boardLayout}</p>
        <div className="wr-players">
          {room.players.map((p) => (
            <div key={p.username} className="wr-player">
              <span className="wr-dot" style={{ background: PLAYER_FILL[p.color as PlayerColor] }} title={PLAYER_LABEL[p.color as PlayerColor]} />
              <b>{p.username}</b>
              {p.isHost && <span className="su-tag host"><Crown size={12} /> Anfitrião</span>}
            </div>
          ))}
          {Array.from({ length: Math.max(0, room.maxPlayers - room.players.length) }, (_, i) => (
            <div key={`open-${i}`} className="wr-player open">
              <span className="wr-dot empty" /> <em>Vaga aberta</em>
            </div>
          ))}
        </div>

        {canStart ? (
          <button className="cta big" disabled={starting} onClick={start}>
            <Play size={16} /> {starting ? 'Iniciando…' : 'Começar partida'}
          </button>
        ) : (
          <p className="muted-note wr-wait">
            {room.isHost
              ? 'Abra esta sala a partir de “Criar salão” para iniciar a partida.'
              : 'Aguardando o anfitrião iniciar a partida…'}
          </p>
        )}
      </div>
    </div>
  );
}
