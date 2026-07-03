import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Copy, Check, Crown, Lock, Play, ArrowLeft, Users, Bot, Dices, Target, Shield,
  Shuffle, UserPlus, X, Link as LinkIcon,
} from 'lucide-react';
import { PLAYER_COLORS, type BoardLayout, type DesertPlacement, type NumberLayout, type PlayerColor } from '@trevalis/engine';
import type { Difficulty } from '@trevalis/bot';
import { authClient } from '../auth/client.js';
import { PLAYER_FILL, PLAYER_LABEL } from '../game/theme.js';
import { pickBotName } from '../game/botNames.js';
import type { GameSetup, Pace } from '../game/config.js';
import { Game } from '../Game.js';
import { GameClient } from '../net/client.js';
import { createRoomApi, getRoomApi, joinRoomApi, roomLink, startRoomApi, type RoomView } from './rooms.js';
import { LoginGate } from './LoginGate.js';

const MAP_LABEL: Record<string, string> = {
  standard: 'Clássico (3–4)',
  large: 'Grande (5–6)',
  huge: 'Enorme (7–8)',
};

/** Crests por cor (mesmos do jogo) para a UI ficar coerente. */
const CREST: Record<PlayerColor, string> = { red: '👑', blue: '🌿', white: '⚒️', orange: '🪓', green: '🍀', brown: '🐗', purple: '🔮', pink: '🌸' };
const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };

/** Os tres mapas: cada um define o LIMITE de jogadores e o tabuleiro. */
const MAPS: { key: BoardLayout; label: string; hint: string; limit: number }[] = [
  { key: 'standard', label: '3–4 jogadores', hint: '19 hexágonos', limit: 4 },
  { key: 'large', label: '5–6 jogadores', hint: '30 hexágonos · 2 desertos', limit: 6 },
  { key: 'huge', label: '7–8 jogadores', hint: '37 hexágonos · 2 desertos', limit: 8 },
];
const MAX_SEATS = 8;

type Seat = { type: 'host' } | { type: 'open' } | { type: 'bot'; diff: Difficulty; name: string };

const initialSeats = (): Seat[] => [
  { type: 'host' },
  ...Array.from({ length: MAX_SEATS - 1 }, () => ({ type: 'open' }) as Seat),
];

/** URL do WebSocket na MESMA origem (dev: Vite faz proxy de /ws -> :8080). */
function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

/**
 * Tela única de sala (itens 1-2 do backlog de rotas): "Monte sua mesa" (sem
 * código ainda) e a sala em si (link + jogadores + partida) são o MESMO
 * componente — criar a sala nunca troca de tela, só passa a mostrar o link.
 * `code` vem da URL (`/room/:code`, sincronizada pelo App); `null` = ainda
 * configurando.
 */
export function RoomScreen({
  code,
  onRoomCreated,
  onLeave,
  onNeedAuth,
  onFullscreenChange,
}: {
  code: string | null;
  /** Sala online criada (sem sair da tela) — o App sincroniza a URL para /room/CODE. */
  onRoomCreated: (code: string) => void;
  onLeave: () => void;
  onNeedAuth: () => void;
  /** A partida em si ocupa a tela inteira (sem o header do site). */
  onFullscreenChange: (fullscreen: boolean) => void;
}) {
  useEffect(() => {
    if (!code) onFullscreenChange(false);
  }, [code, onFullscreenChange]);

  if (!code) {
    return <RoomSetupForm onRoomCreated={onRoomCreated} onNeedAuth={onNeedAuth} onBack={onLeave} />;
  }
  return <RoomLive code={code} onLeave={onLeave} onNeedAuth={onNeedAuth} onFullscreenChange={onFullscreenChange} />;
}

/* ------------------------------------------------------------------ */
/* 1. "Monte sua mesa" — sem código ainda                              */
/* ------------------------------------------------------------------ */

function RoomSetupForm({
  onRoomCreated,
  onNeedAuth,
  onBack,
}: {
  onRoomCreated: (code: string) => void;
  onNeedAuth: () => void;
  onBack?: () => void;
}) {
  const { data: session, isPending } = authClient.useSession();
  const loggedIn = Boolean(session?.user);

  const [mapKey, setMapKey] = useState<BoardLayout>('standard');
  const [hostName, setHostName] = useState('Você');
  // Sala recem-criada: so o anfitriao; as demais vagas comecam ABERTAS.
  const [seats, setSeats] = useState<Seat[]>(initialSeats);
  const [numberLayout, setNumberLayout] = useState<NumberLayout>('balanced');
  const [desert, setDesert] = useState<DesertPlacement>('random');
  const [pointsToWin, setPointsToWin] = useState(10);
  const [discardLimit, setDiscardLimit] = useState(7);
  const [friendlyRobber, setFriendlyRobber] = useState(false);
  const [pace, setPace] = useState<Pace>('normal');
  const [seedText, setSeedText] = useState('');
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const limit = MAPS.find((m) => m.key === mapKey)!.limit;
  const visible = seats.slice(0, limit);
  const occupants = seats.filter((s) => s.type !== 'open').length;

  const colorByIndex = useMemo(() => {
    const out: (PlayerColor | null)[] = [];
    let ci = 0;
    for (const s of visible) out.push(s.type === 'open' ? null : PLAYER_COLORS[ci++]!);
    return out;
  }, [visible]);

  const filledCount = colorByIndex.filter(Boolean).length;
  const canStart = filledCount >= 1;

  function setSeat(i: number, s: Seat) {
    setSeats((prev) => {
      const next = [...prev];
      next[i] = s;
      return next;
    });
  }

  function addBot(i: number) {
    setSeats((prev) => {
      const used = [hostName.trim(), ...prev.flatMap((s) => (s.type === 'bot' ? [s.name] : []))];
      const next = [...prev];
      next[i] = { type: 'bot', diff: 'medium', name: pickBotName(used).name };
      return next;
    });
  }

  function chooseMap(key: BoardLayout) {
    const newLimit = MAPS.find((m) => m.key === key)!.limit;
    if (occupants > newLimit) return;
    if (key !== 'standard') setDesert('random');
    setSeats((prev) => {
      const taken = prev.filter((s) => s.type !== 'open');
      const compact: Seat[] = [...taken];
      while (compact.length < MAX_SEATS) compact.push({ type: 'open' });
      return compact;
    });
    setMapKey(key);
  }

  function buildSetup(): GameSetup {
    const seed = seedText.trim() === '' ? null : hashSeed(seedText.trim());
    const players: { color: PlayerColor; name: string }[] = [];
    const bots: PlayerColor[] = [];
    const botDifficulty: Record<string, Difficulty> = {};
    let ci = 0;
    visible.forEach((s) => {
      if (s.type === 'open') return;
      const color = PLAYER_COLORS[ci++]!;
      if (s.type === 'host') {
        players.push({ color, name: hostName.trim() || 'Você' });
      } else {
        players.push({ color, name: s.name });
        bots.push(color);
        botDifficulty[color] = s.diff;
      }
    });
    return {
      players, bots, botDifficulty: botDifficulty as Record<PlayerColor, Difficulty>,
      seed, boardLayout: mapKey, pace, numberLayout, desert, pointsToWin, discardLimit, friendlyRobber,
    };
  }

  /** Cria a sala ONLINE (gera link único) sem sair desta tela. */
  async function createOnline() {
    if (!canStart || creating) return;
    setCreating(true);
    setCreateError(null);
    const setup = buildSetup();
    const res = await createRoomApi({
      name: roomName.trim() || `Sala de ${hostName.trim() || 'anfitrião'}`,
      isPrivate,
      maxPlayers: limit,
      boardLayout: mapKey,
      config: setup as unknown as Record<string, unknown>,
    });
    setCreating(false);
    if (!res.ok) {
      setCreateError(res.error);
      return;
    }
    onRoomCreated(res.room.code);
  }

  // Criar sala é rota protegida (só a Home é pública): sem login, redireciona.
  if (isPending) {
    return <div className="page"><p className="muted-note">Carregando…</p></div>;
  }
  if (!loggedIn) {
    return (
      <LoginGate
        title="Entre para criar uma sala"
        hint="Você precisa de uma conta para criar uma mesa (com bots ou com amigos)."
        onNeedAuth={onNeedAuth}
      />
    );
  }

  return (
    <div className="page setup-page">
      <div className="page-head">
        <div>
          {onBack && <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Voltar ao lobby</button>}
          <span className="eyebrow">CRIAR SALA</span>
          <h1>Monte sua mesa.</h1>
        </div>
      </div>

      <div className="setup-grid">
        <div className="card su-players">
          <h2 className="su-h"><Users size={18} className="ic-primary" /> Jogadores <span className="su-count">{filledCount}/{limit}</span></h2>

          <div className="su-maps">
            {MAPS.map((m) => {
              const disabled = occupants > m.limit;
              return (
                <button
                  key={m.key}
                  className={`su-map${mapKey === m.key ? ' on' : ''}`}
                  disabled={disabled}
                  title={disabled ? `Remova jogadores para usar este mapa (máx. ${m.limit})` : undefined}
                  onClick={() => chooseMap(m.key)}
                >
                  <b>{m.label}</b>
                  <small>{m.hint}</small>
                </button>
              );
            })}
          </div>
          <p className="su-note">Convide amigos pelo link ou preencha as vagas com bots — jogue de 1 até {limit}.</p>

          {visible.map((s, i) => {
            const color = colorByIndex[i];
            if (s.type === 'open') {
              return (
                <div key={i} className="su-seat open">
                  <span className="su-open-label"><UserPlus size={16} /> Vaga aberta <em>aguardando jogador</em></span>
                  <button className="su-addbot" onClick={() => addBot(i)}><Bot size={15} /> Adicionar bot</button>
                </div>
              );
            }
            const c = color!;
            if (s.type === 'host') {
              return (
                <div key={i} className="su-seat filled" style={{ borderLeftColor: PLAYER_FILL[c] }}>
                  <span className="su-crest" style={{ background: PLAYER_FILL[c] }} title={PLAYER_LABEL[c]}>{CREST[c]}</span>
                  <input className="su-name" value={hostName} maxLength={16} onChange={(e) => setHostName(e.target.value)} />
                  <span className="su-tag host"><Crown size={12} /> Anfitrião</span>
                </div>
              );
            }
            return (
              <div key={i} className="su-seat filled bot" style={{ borderLeftColor: PLAYER_FILL[c] }}>
                <div className="su-seat-row">
                  <span className="su-crest" style={{ background: PLAYER_FILL[c] }} title={PLAYER_LABEL[c]}>{CREST[c]}</span>
                  <span className="su-name bot-name"><Bot size={14} /> {s.name}</span>
                  <button className="su-remove" title="Remover da sala" onClick={() => setSeat(i, { type: 'open' })}><X size={15} /></button>
                </div>
                <div className="su-seg xs su-seat-diff">
                  {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                    <button key={d} className={s.diff === d ? 'on' : ''} onClick={() => setSeat(i, { type: 'bot', diff: d, name: s.name })}>{DIFF_LABEL[d]}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="card su-settings">
          <h3 className="su-sub">Tabuleiro</h3>
          <div className="su-tiles">
            <SetupTile icon={<Dices size={20} />} label="Números equilibrados" hint="6 e 8 nunca vizinhos"
              active={numberLayout === 'balanced'} onClick={() => setNumberLayout((v) => (v === 'balanced' ? 'random' : 'balanced'))} />
            <SetupTile icon={<Target size={20} />} label="Deserto no centro"
              hint={mapKey === 'standard' ? 'ladrão começa no meio' : 'só no mapa 3–4'}
              disabled={mapKey !== 'standard'}
              active={mapKey === 'standard' && desert === 'center'}
              onClick={() => setDesert((v) => (v === 'center' ? 'random' : 'center'))} />
            <SetupTile icon={<Shield size={20} />} label="Ladrão amigável" hint="não bloqueia quem tem < 3 PV"
              active={friendlyRobber} onClick={() => setFriendlyRobber((v) => !v)} />
          </div>

          <h3 className="su-sub">Configurações avançadas</h3>
          <div className="su-pace">
            <label>Ritmo (limite de tempo das ações, no online)</label>
            <div className="su-seg sm">
              <button className={pace === 'normal' ? 'on' : ''} onClick={() => setPace('normal')}>Normal</button>
              <button className={pace === 'fast' ? 'on' : ''} onClick={() => setPace('fast')}>Rápido</button>
            </div>
          </div>
          <div className="su-slider">
            <label>Pontos para vencer <b>{pointsToWin}</b></label>
            <input type="range" min={3} max={15} value={pointsToWin} onChange={(e) => setPointsToWin(+e.target.value)} />
          </div>
          <div className="su-slider">
            <label>Limite de cartas (descarte no 7) <b>{discardLimit}</b></label>
            <input type="range" min={5} max={15} value={discardLimit} onChange={(e) => setDiscardLimit(+e.target.value)} />
          </div>
          <div className="su-slider">
            <label>Seed (opcional)</label>
            <div className="su-seed">
              <input value={seedText} placeholder="aleatória" onChange={(e) => setSeedText(e.target.value)} />
              <button onClick={() => setSeedText('')}><Shuffle size={14} /> Aleatória</button>
            </div>
          </div>

          <div className="su-room-online">
            <h3 className="su-sub">Sala online (link compartilhável)</h3>
            <div className="su-slider">
              <label>Nome da sala</label>
              <input
                className="su-roomname"
                value={roomName}
                maxLength={40}
                placeholder={`Sala de ${hostName.trim() || 'anfitrião'}`}
                onChange={(e) => setRoomName(e.target.value)}
              />
            </div>
            <button
              className={`su-tile su-private${isPrivate ? ' active' : ''}`}
              onClick={() => setIsPrivate((v) => !v)}
              type="button"
            >
              <span className="su-tile-icon"><Lock size={18} /></span>
              <span className="su-tile-label">Sala privada</span>
              <span className="su-tile-hint">{isPrivate ? 'só por link; fora da listagem' : 'aparece no lobby público'}</span>
            </button>
          </div>

          {createError && <div className="auth-error">{createError}</div>}

          <button className="cta big su-start" disabled={!canStart || creating} onClick={createOnline}>
            <LinkIcon size={16} /> {creating ? 'Criando sala…' : 'Criar sala'}
          </button>
          <p className="su-note">
            Jogue sozinho contra bots (preencha as vagas com "Adicionar bot") ou convide amigos pelo link — o servidor gerencia a partida.
          </p>
        </div>
      </div>
    </div>
  );
}

function SetupTile({ icon, label, hint, active, disabled, onClick }: { icon: ReactNode; label: string; hint: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`su-tile${active ? ' active' : ''}`} disabled={disabled} onClick={onClick}>
      <span className="su-tile-icon">{icon}</span>
      <span className="su-tile-label">{label}</span>
      <span className="su-tile-hint">{hint}</span>
    </button>
  );
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* 2. Sala com código: link + jogadores (espera) + partida ao vivo      */
/* ------------------------------------------------------------------ */

/** Instantâneo online mantido pelo RoomLive a partir das mensagens do GameClient. */
interface LiveSnapshot {
  viewerColor: PlayerColor | null;
  bots: PlayerColor[];
  awayColors: PlayerColor[];
  deadlineSeconds: number | null;
  state: import('@trevalis/engine').GameState | null;
  events: import('@trevalis/engine').GameEvent[];
  seq: number;
  error: string | null;
  errorSeq: number;
}

function RoomLive({
  code,
  onLeave,
  onNeedAuth,
  onFullscreenChange,
}: {
  code: string;
  onLeave: () => void;
  onNeedAuth: () => void;
  onFullscreenChange: (fullscreen: boolean) => void;
}) {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user;

  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const joinedRef = useRef(false);

  // Entrada (idempotente) ao montar, quando autenticado.
  useEffect(() => {
    if (!user || joinedRef.current) return;
    joinedRef.current = true;
    void joinRoomApi(code).then((r) => {
      if (r.ok) setRoom(r.room);
      else setError(r.error);
    });
  }, [user, code]);

  // Reflete quem entrou pelo link em tempo (quase) real: enquanto a sala aguarda,
  // todo cliente conectado consulta a sala em ciclo curto e também assim que a aba
  // recupera o foco. Esse mesmo ciclo é o heartbeat que mantém a sala viva (item 6).
  useEffect(() => {
    if (!user || error || room?.status !== 'waiting') return;
    const refresh = () => {
      void getRoomApi(code).then((r) => {
        if (r.ok) setRoom(r.room);
        else setError(r.error);
      });
    };
    const id = setInterval(refresh, 2500);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, code, error, room?.status]);

  function copy() {
    void navigator.clipboard?.writeText(roomLink(code)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  async function start() {
    setStarting(true);
    const res = await startRoomApi(code);
    setStarting(false);
    if (res.ok) setRoom(res.room); // status agora 'in_progress' -> conecta o WS abaixo
    else setError(res.error);
  }

  /* ---- WebSocket: liga quando a sala esta em andamento/finalizada ---- */
  const live = room?.status === 'in_progress' || room?.status === 'finished';
  const [online, setOnline] = useState<LiveSnapshot | null>(null);
  const [wsDisconnected, setWsDisconnected] = useState(false);
  const clientRef = useRef<GameClient | null>(null);

  useEffect(() => {
    if (!live) return;
    const client = new GameClient();
    clientRef.current = client;
    let seq = 0;
    let errorSeq = 0;

    client.onJoined = (_code, color, bots) => {
      setOnline((prev) => ({
        viewerColor: color,
        bots,
        awayColors: prev?.awayColors ?? [],
        deadlineSeconds: prev?.deadlineSeconds ?? null,
        state: prev?.state ?? null,
        events: [],
        seq: prev?.seq ?? 0,
        error: prev?.error ?? null,
        errorSeq: prev?.errorSeq ?? 0,
      }));
    };
    client.onState = (state, awayColors, deadlineSeconds, events) => {
      seq += 1;
      setOnline((prev) => ({
        viewerColor: prev?.viewerColor ?? null,
        bots: prev?.bots ?? [],
        awayColors,
        deadlineSeconds,
        state,
        events,
        seq,
        error: prev?.error ?? null,
        errorSeq: prev?.errorSeq ?? 0,
      }));
    };
    client.onError = (err) => {
      errorSeq += 1;
      setOnline((prev) =>
        prev && { ...prev, error: err, errorSeq },
      );
    };
    client.onDisconnected = () => setWsDisconnected(true);
    client.onReconnected = () => setWsDisconnected(false);

    void client.connect(wsUrl()).then(() => client.enter(code));

    return () => {
      client.close();
      clientRef.current = null;
      setOnline(null);
    };
  }, [live, code]);

  useEffect(() => {
    onFullscreenChange(live === true && online?.state != null);
    return () => onFullscreenChange(false);
  }, [live, online?.state, onFullscreenChange]);

  function exitGame() {
    clientRef.current?.close();
    onLeave();
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

  // Partida em andamento/finalizada: joga (ou assiste, se nao sou jogador) em tela cheia.
  if (live) {
    if (!online?.state) {
      return <div className="page"><p className="muted-note">Conectando à partida…</p></div>;
    }
    return (
      <>
        {wsDisconnected && <div className="wr-reconnect-banner">Conexão perdida — reconectando…</div>}
        <Game
          onExit={exitGame}
          online={{
            client: clientRef.current!,
            viewerColor: online.viewerColor,
            bots: online.bots,
            awayColors: online.awayColors,
            deadlineSeconds: online.deadlineSeconds,
            state: online.state,
            events: online.events,
            seq: online.seq,
            error: online.error,
            errorSeq: online.errorSeq,
          }}
        />
      </>
    );
  }

  const canStart = room.isHost;

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
          <p className="muted-note wr-wait">Aguardando o anfitrião iniciar a partida…</p>
        )}
      </div>
    </div>
  );
}
