import { useEffect, useRef, useState } from 'react';
import { Zap, Users, Lock, Plus, Globe, RefreshCw, X } from 'lucide-react';
import { authClient } from '../auth/client.js';
import { joinRoomApi, listRooms, type RoomListItem } from './rooms.js';
import { getMatchmakingStatus, joinQuickMatch, leaveQuickMatch } from './social.js';
import { LoginGate } from './LoginGate.js';

const MAP_LABEL: Record<string, string> = {
  standard: 'Clássico (3–4)',
  large: 'Grande (5–6)',
  huge: 'Enorme (7–8)',
};

export function RoomBrowser({
  onCreate,
  onEnterRoom,
  onNeedAuth,
}: {
  onCreate: () => void;
  onEnterRoom: (code: string) => void;
  onNeedAuth: () => void;
}) {
  const { data: session, isPending } = authClient.useSession();
  const loggedIn = Boolean(session?.user);

  const [rooms, setRooms] = useState<RoomListItem[]>([]);
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
      setError('Não foi possível entrar na fila agora.');
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
      setRooms(r);
      setLoading(false);
    });
  }

  // Só busca a listagem quando autenticado (a API do lobby exige sessão).
  useEffect(() => {
    if (loggedIn) refresh();
  }, [loggedIn]);

  // Lobby é rota protegida: sem sessão, redireciona ao login (a Home é a única pública).
  if (isPending) {
    return <div className="page"><p className="muted-note">Carregando…</p></div>;
  }
  if (!loggedIn) {
    return (
      <LoginGate
        title="Entre para ver o lobby"
        hint="Você precisa de uma conta para navegar e entrar em salas."
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">LOBBY</span>
          <h1>Escolha uma mesa.</h1>
        </div>
        <button className="cta" onClick={onCreate}><Plus size={16} /> Criar salão</button>
      </div>

      <div className="quick-cards">
        {/*
          "Jogo rápido" (matchmaking casual) LIGADO — Tier 2. "Ranqueada" segue
          "Em breve" até o sistema de ELO (branch competitiva). Ver docs/backlog.md.
        */}
        <div className="quick-card">
          <span className="quick-icon"><Zap size={18} /></span>
          <h3>Jogo rápido</h3>
          <p>Entramos numa mesa casual e completamos com bots.</p>
          <button className="dark" onClick={startQuickMatch} disabled={searching}>
            {searching ? 'Procurando…' : 'Jogar'}
          </button>
        </div>
        <div className="quick-card green disabled" aria-disabled="true">
          <span className="soon-tag">Em breve</span>
          <span className="quick-icon"><Users size={18} /></span>
          <h3>Ranqueada</h3>
          <p>Suba sua pontuação na temporada.</p>
          <button className="dark" disabled>Encontrar partida</button>
        </div>
        <div className="quick-card">
          <span className="quick-icon"><Lock size={18} /></span>
          <h3>Partida privada</h3>
          <p>Crie um link e chame quem você quiser.</p>
          <button className="dark" onClick={onCreate}>Criar salão</button>
        </div>
      </div>

      {/*
        Removidos: campo de busca (nome/host) e filtros Mapa/Modo — operavam sobre dados
        mockados. As colunas "Modo" e "Ping" também saíram (eram mockadas; não há
        ranqueada nem medição de ping real). Ver docs/backlog.md → Lobby. Reimplementar
        sobre a listagem real (GET /api/rooms) com query params no backend.
      */}

      <div className="room-bar">
        <span className="eyebrow">Salas abertas</span>
        <button className="ghost sm" onClick={refresh}><RefreshCw size={14} /> Atualizar</button>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="room-table live">
        <div className="room-row head">
          <span>SALÃO</span><span>MAPA</span><span>JOGADORES</span><span></span>
        </div>
        {loading ? (
          <div className="room-empty">Carregando salas…</div>
        ) : rooms.length === 0 ? (
          <div className="room-empty">
            Nenhuma sala aberta agora. <button className="link" onClick={onCreate}>Crie a primeira!</button>
          </div>
        ) : (
          rooms.map((r) => (
            <div key={r.code} className="room-row">
              <span className="room-name">
                <b><Globe size={13} className="room-online" /> {r.name}</b>
                <small>por @{r.host}</small>
              </span>
              <span>{MAP_LABEL[r.boardLayout] ?? r.boardLayout}</span>
              <span className="seats">
                {Array.from({ length: r.max }, (_, i) => <i key={i} className={i < r.cur ? 'on' : ''} />)}
                <small> {r.cur}/{r.max}</small>
              </span>
              <span>
                <button
                  className="cta sm"
                  disabled={joining === r.code || r.cur >= r.max}
                  onClick={() => enter(r.code)}
                >
                  {r.cur >= r.max ? 'Cheia' : joining === r.code ? 'Entrando…' : 'Entrar'}
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {searching && (
        <div className="overlay">
          <div className="modal mm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mm-spinner"><Zap size={26} /></div>
            <h3>Procurando partida…</h3>
            <p className="muted-note">
              {queueCount > 1 ? `${queueCount} jogadores na fila` : 'Você entrou na fila'} · completamos com bots em alguns segundos.
            </p>
            <button className="ghost" onClick={cancelQuickMatch}><X size={15} /> Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
