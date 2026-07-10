import { useEffect, useRef, useState } from 'react';
import { Zap, Users, Lock, Plus, Globe, RefreshCw, X } from 'lucide-react';
import { authClient } from '../auth/client.js';
import { joinRoomApi, listRooms, type RoomListItem } from './rooms.js';
import { getMatchmakingStatus, joinQuickMatch, leaveQuickMatch } from './social.js';
import { LoginGate } from './LoginGate.js';
import { useT, type MsgKey } from '../i18n/index.js';

const MAP_LABEL: Record<string, MsgKey> = {
  standard: 'map.standard',
  large: 'map.large',
  huge: 'map.huge',
};

export function RoomBrowser({
  onCreate,
  onEnterRoom,
  onNeedAuth,
}: {
  onCreate: (opts?: { isPrivate?: boolean }) => void;
  onEnterRoom: (code: string) => void;
  onNeedAuth: () => void;
}) {
  const { data: session, isPending } = authClient.useSession();
  const loggedIn = Boolean(session?.user);
  const t = useT();

  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [friendRooms, setFriendRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  // Matchmaking "Jogo rápido": busca automática por uma mesa.
  const [searching, setSearching] = useState(false);
  const [queueCount, setQueueCount] = useState(1);
  const searchingRef = useRef(false);

  useEffect(() => {
    searchingRef.current = searching;
  }, [searching]);

  // Polling da fila: enquanto busca, consulta o status; ao casar, entra na mesa.
  useEffect(() => {
    if (!searching) return;
    let alive = true;
    const tick = async () => {
      const s = await getMatchmakingStatus();
      if (!alive) return;
      if (s.state === 'matched') {
        setSearching(false);
        onEnterRoom(s.code);
      } else if (s.state === 'searching') {
        setQueueCount(s.players);
      } else {
        setSearching(false);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [searching, onEnterRoom]);

  // Se sair da tela buscando, libera a vaga na fila.
  useEffect(() => () => { if (searchingRef.current) void leaveQuickMatch(); }, []);

  async function startQuickMatch() {
    setError(null);
    const code = await joinQuickMatch();
    if (!code) {
      setError(t('lobby.errQueue'));
      return;
    }
    setQueueCount(1);
    setSearching(true);
  }

  function cancelQuickMatch() {
    setSearching(false);
    void leaveQuickMatch();
  }

  function refresh() {
    setLoading(true);
    void listRooms().then((r) => {
      setRooms(r.rooms);
      setFriendRooms(r.friendRooms);
      setLoading(false);
    });
  }

  // Só busca a listagem quando autenticado (a API do lobby exige sessão).
  useEffect(() => {
    if (loggedIn) refresh();
  }, [loggedIn]);

  // Lobby é rota protegida: sem sessão, redireciona ao login (a Home é a única pública).
  if (isPending) {
    return <div className="page"><p className="muted-note">{t('common.loading')}</p></div>;
  }
  if (!loggedIn) {
    return (
      <LoginGate
        title={t('lobby.gate.title')}
        hint={t('lobby.gate.hint')}
        onNeedAuth={onNeedAuth}
      />
    );
  }

  async function enter(code: string) {
    if (!loggedIn) {
      onNeedAuth();
      return;
    }
    setError(null);
    setJoining(code);
    const res = await joinRoomApi(code);
    setJoining(null);
    if (res.ok) {
      onEnterRoom(code);
    } else {
      setError(res.error);
      refresh(); // a sala pode ter enchido/iniciado — atualiza a listagem
    }
  }

  /** Uma linha de sala (reaproveitada nas listas de amigos e pública). */
  function roomRow(r: RoomListItem) {
    return (
      <div key={r.code} className="room-row">
        <span className="room-name">
          <b>{r.isPrivate ? <Lock size={13} className="room-online" /> : <Globe size={13} className="room-online" />} {r.name}</b>
          <small>{t('lobby.byHost', { host: r.host })}</small>
        </span>
        <span>{MAP_LABEL[r.boardLayout] ? t(MAP_LABEL[r.boardLayout]!) : r.boardLayout}</span>
        <span className="seats">
          {Array.from({ length: r.max }, (_, i) => <i key={i} className={i < r.cur ? 'on' : ''} />)}
          <small> {r.cur}/{r.max}</small>
        </span>
        <span>
          <button className="cta sm" disabled={joining === r.code || r.cur >= r.max} onClick={() => enter(r.code)}>
            {r.cur >= r.max ? t('lobby.full') : joining === r.code ? t('lobby.entering') : t('lobby.enter')}
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{t('lobby.eyebrow')}</span>
          <h1>{t('lobby.title')}</h1>
        </div>
        <button className="cta" onClick={() => onCreate()}><Plus size={16} /> {t('lobby.createRoom')}</button>
      </div>

      <div className="quick-cards">
        {/*
          "Jogo rápido" (matchmaking casual) LIGADO — Tier 2. "Ranqueada" segue
          "Em breve" até o sistema de ELO (branch competitiva). Ver docs/backlog.md.
        */}
        <div className="quick-card">
          <span className="quick-icon"><Zap size={18} /></span>
          <h3>{t('lobby.quick.title')}</h3>
          <p>{t('lobby.quick.text')}</p>
          <button className="dark" onClick={startQuickMatch} disabled={searching}>
            {searching ? t('lobby.quick.searching') : t('lobby.quick.play')}
          </button>
        </div>
        <div className="quick-card green disabled" aria-disabled="true">
          <span className="soon-tag">{t('lobby.ranked.soon')}</span>
          <span className="quick-icon"><Users size={18} /></span>
          <h3>{t('lobby.ranked.title')}</h3>
          <p>{t('lobby.ranked.text')}</p>
          <button className="dark" disabled>{t('lobby.ranked.cta')}</button>
        </div>
        <div className="quick-card">
          <span className="quick-icon"><Lock size={18} /></span>
          <h3>{t('lobby.private.title')}</h3>
          <p>{t('lobby.private.text')}</p>
          <button className="dark" onClick={() => onCreate({ isPrivate: true })}>{t('lobby.createRoom')}</button>
        </div>
      </div>

      {/*
        Removidos: campo de busca (nome/host) e filtros Mapa/Modo — operavam sobre dados
        mockados. As colunas "Modo" e "Ping" também saíram (eram mockadas; não há
        ranqueada nem medição de ping real). Ver docs/backlog.md → Lobby. Reimplementar
        sobre a listagem real (GET /api/rooms) com query params no backend.
      */}

      {friendRooms.length > 0 && (
        <>
          <div className="room-bar">
            <span className="eyebrow"><Users size={13} /> {t('lobby.friendRooms')}</span>
          </div>
          <div className="room-table live">
            <div className="room-row head">
              <span>{t('lobby.col.room')}</span><span>{t('lobby.col.map')}</span><span>{t('lobby.col.players')}</span><span></span>
            </div>
            {friendRooms.map(roomRow)}
          </div>
        </>
      )}

      <div className="room-bar">
        <span className="eyebrow">{t('lobby.openRooms')}</span>
        <button className="ghost sm" onClick={refresh}><RefreshCw size={14} /> {t('lobby.refresh')}</button>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="room-table live">
        <div className="room-row head">
          <span>{t('lobby.col.room')}</span><span>{t('lobby.col.map')}</span><span>{t('lobby.col.players')}</span><span></span>
        </div>
        {loading ? (
          <div className="room-empty">{t('lobby.loadingRooms')}</div>
        ) : rooms.length === 0 ? (
          <div className="room-empty">
            {t('lobby.noRooms')} <button className="link" onClick={() => onCreate()}>{t('lobby.noRoomsCta')}</button>
          </div>
        ) : (
          rooms.map(roomRow)
        )}
      </div>

      {searching && (
        <div className="overlay">
          <div className="modal mm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mm-spinner"><Zap size={26} /></div>
            <h3>{t('lobby.mm.title')}</h3>
            <p className="muted-note">
              {queueCount > 1 ? t('lobby.mm.queueCount', { n: queueCount }) : t('lobby.mm.queued')} · {t('lobby.mm.tail')}
            </p>
            <button className="ghost" onClick={cancelQuickMatch}><X size={15} /> {t('common.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
