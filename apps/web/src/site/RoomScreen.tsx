import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Copy, Check, Crown, Lock, Play, ArrowLeft, Users, Bot, Dices, Target, Shield,
  Shuffle, UserPlus, X,
} from 'lucide-react';
import { type BoardLayout, type PlayerColor } from '@trevalis/engine';
import type { Difficulty } from '@trevalis/bot';
import { authClient } from '../auth/client.js';
import { PLAYER_FILL, PLAYER_LABEL } from '../game/theme.js';
import { pickBotName } from '../game/botNames.js';
import { Game } from '../Game.js';
import { GameClient } from '../net/client.js';
import {
  addBotApi, createRoomApi, getRoomApi, joinRoomApi, leaveRoomApi, removeBotApi,
  roomLink, setBotDifficultyApi, startRoomApi, updateRoomApi,
  type RoomSeatView, type RoomView,
} from './rooms.js';
import { LoginGate } from './LoginGate.js';

const MAP_LABEL: Record<string, string> = {
  standard: 'Clássico (3–4)',
  large: 'Grande (5–6)',
  huge: 'Enorme (7–8)',
};

/** Crests por cor (mesmos do jogo) para a UI ficar coerente. */
const CREST: Record<PlayerColor, string> = { red: '👑', blue: '🌿', white: '⚒️', orange: '🪓', green: '🍀', brown: '🐗', purple: '🔮', pink: '🌸' };
const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };

/** Os três mapas: cada um define o LIMITE de jogadores e o tabuleiro. */
const MAPS: { key: BoardLayout; label: string; hint: string; limit: number }[] = [
  { key: 'standard', label: '3–4 jogadores', hint: '19 hexágonos', limit: 4 },
  { key: 'large', label: '5–6 jogadores', hint: '30 hexágonos · 2 desertos', limit: 6 },
  { key: 'huge', label: '7–8 jogadores', hint: '37 hexágonos · 2 desertos', limit: 8 },
];

function mapLimit(boardLayout: string): number {
  return MAPS.find((m) => m.key === boardLayout)?.limit ?? 4;
}

/** URL do WebSocket na MESMA origem (dev: Vite faz proxy de /ws -> :8080). */
function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Tela ÚNICA de sala. A sala nasce no servidor assim que a página abre (link já
 * disponível); o anfitrião edita regras/bots e convidados entram/saem AO VIVO,
 * tudo aqui — não existe mais uma "sala de espera" separada. Quando o host clica
 * "Começar partida", este mesmo componente passa a mostrar o jogo em tela cheia.
 */
export function RoomScreen({
  code,
  onRoomCreated,
  onLeave,
  onNeedAuth,
  onFullscreenChange,
}: {
  code: string | null;
  /** Sala criada — o App sincroniza a URL para /room/CODE. */
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
    return <CreateRoom onRoomCreated={onRoomCreated} onNeedAuth={onNeedAuth} onBack={onLeave} />;
  }
  return <Room code={code} onLeave={onLeave} onNeedAuth={onNeedAuth} onFullscreenChange={onFullscreenChange} />;
}

/* ------------------------------------------------------------------ */
/* Criação: a sala nasce no servidor ao abrir a página                  */
/* ------------------------------------------------------------------ */

const DEFAULT_CONFIG = {
  boardLayout: 'standard',
  pace: 'normal',
  numberLayout: 'balanced',
  desert: 'random',
  pointsToWin: 10,
  discardLimit: 7,
  friendlyRobber: false,
  balancedDice: false,
  seed: null,
  bots: [] as unknown[],
};

function CreateRoom({
  onRoomCreated,
  onNeedAuth,
  onBack,
}: {
  onRoomCreated: (code: string) => void;
  onNeedAuth: () => void;
  onBack: () => void;
}) {
  const { data: session, isPending } = authClient.useSession();
  const loggedIn = Boolean(session?.user);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!loggedIn || startedRef.current) return;
    startedRef.current = true;
    const who = session?.user.name ?? 'você';
    void createRoomApi({
      name: `Sala de ${who}`.slice(0, 40),
      isPrivate: false,
      maxPlayers: 4,
      boardLayout: 'standard',
      config: { ...DEFAULT_CONFIG },
    }).then((res) => {
      if (res.ok) onRoomCreated(res.room.code);
      else {
        setError(res.error);
        startedRef.current = false;
      }
    });
  }, [loggedIn, session, onRoomCreated]);

  if (isPending) return <div className="page"><p className="muted-note">Carregando…</p></div>;
  if (!loggedIn) {
    return (
      <LoginGate
        title="Entre para criar uma sala"
        hint="Você precisa de uma conta para criar uma mesa (com bots ou com amigos)."
        onNeedAuth={onNeedAuth}
      />
    );
  }
  if (error) {
    return (
      <div className="page">
        <div className="card wr-gate">
          <h2>{error}</h2>
          <button className="ghost" onClick={onBack}><ArrowLeft size={15} /> Voltar ao lobby</button>
        </div>
      </div>
    );
  }
  return <div className="page"><p className="muted-note">Criando sala…</p></div>;
}

/* ------------------------------------------------------------------ */
/* Sala (código): espera editável ao vivo -> partida em tela cheia      */
/* ------------------------------------------------------------------ */

/** Instantâneo online mantido a partir das mensagens do GameClient. */
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

function Room({
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

  // Enquanto aguarda: consulta a sala em ciclo curto (roster ao vivo) e no foco.
  // Esse mesmo ciclo é o heartbeat que mantém a sala viva (item 6).
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

  /* ---- WebSocket: liga quando a sala está em andamento/finalizada ---- */
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
      setOnline((prev) => prev && { ...prev, error: err, errorSeq });
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

  /** Sair da espera: convidado libera a vaga, host encerra a sala; depois navega. */
  function leaveWaiting() {
    void leaveRoomApi(code);
    onLeave();
  }

  // --- estados de borda ---
  if (isPending) {
    return <div className="page"><p className="muted-note">Carregando…</p></div>;
  }
  if (!user) {
    return (
      <LoginGate
        title="Entre para acessar a sala"
        hint="Você precisa de uma conta para entrar em uma sala."
        onNeedAuth={onNeedAuth}
      />
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

  // Partida em andamento/finalizada: joga (ou assiste) em tela cheia.
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

  // Espera: o anfitrião monta a mesa ao vivo; convidados veem e aguardam.
  return room.isHost ? (
    <HostRoom code={code} room={room} onRoom={setRoom} onError={setError} onLeave={leaveWaiting} />
  ) : (
    <GuestRoom code={code} room={room} onLeave={leaveWaiting} />
  );
}

/* ------------------------------------------------------------------ */
/* Cabeçalho + link (compartilhado entre host e convidado)              */
/* ------------------------------------------------------------------ */

function LinkCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard?.writeText(roomLink(code)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <div className="card wr-link">
      <label>Link da sala — compartilhe para convidar</label>
      <div className="wr-link-row">
        <input readOnly value={roomLink(code)} onFocus={(e) => e.target.select()} />
        <button className="cta" onClick={copy}>
          {copied ? <><Check size={15} /> Copiado!</> : <><Copy size={15} /> Copiar link</>}
        </button>
      </div>
    </div>
  );
}

/** Uma linha do roster (host / convidado / bot), com controles quando for host+bot. */
function SeatRow({
  seat,
  onRemove,
  onDifficulty,
}: {
  seat: RoomSeatView;
  onRemove?: () => void;
  onDifficulty?: (d: Difficulty) => void;
}) {
  const c = seat.color as PlayerColor;
  return (
    <div className={`su-seat filled${seat.isBot ? ' bot' : ''}`} style={{ borderLeftColor: PLAYER_FILL[c] }}>
      <div className="su-seat-row">
        <span className="su-crest" style={{ background: PLAYER_FILL[c] }} title={PLAYER_LABEL[c]}>{CREST[c]}</span>
        <span className="su-name bot-name">
          {seat.isBot ? <Bot size={14} /> : null} {seat.name}
        </span>
        {seat.isHost && <span className="su-tag host"><Crown size={12} /> Anfitrião</span>}
        {onRemove && (
          <button className="su-remove" title="Remover da sala" onClick={onRemove}><X size={15} /></button>
        )}
      </div>
      {seat.isBot && onDifficulty && (
        <div className="su-seg xs su-seat-diff">
          {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
            <button key={d} className={seat.difficulty === d ? 'on' : ''} onClick={() => onDifficulty(d)}>{DIFF_LABEL[d]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function OpenSeat({ onAddBot }: { onAddBot?: () => void }) {
  return (
    <div className="su-seat open">
      <span className="su-open-label"><UserPlus size={16} /> Vaga aberta <em>aguardando jogador</em></span>
      {onAddBot && <button className="su-addbot" onClick={onAddBot}><Bot size={15} /> Adicionar bot</button>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sala do ANFITRIÃO: monta a mesa ao vivo                              */
/* ------------------------------------------------------------------ */

function HostRoom({
  code,
  room,
  onRoom,
  onError,
  onLeave,
}: {
  code: string;
  room: RoomView;
  onRoom: (r: RoomView) => void;
  onError: (e: string | null) => void;
  onLeave: () => void;
}) {
  // Regras editáveis: estado LOCAL (inicializado uma vez da sala), sincronizado
  // ao servidor por PATCH a cada mudança. O polling só atualiza o ROSTER (não
  // sobrescreve estes inputs enquanto o host mexe).
  const s0 = room.settings;
  const [mapKey, setMapKey] = useState<BoardLayout>((room.boardLayout as BoardLayout) ?? 'standard');
  const [roomName, setRoomName] = useState(room.name);
  const [isPrivate, setIsPrivate] = useState(room.isPrivate);
  const [numberLayout, setNumberLayout] = useState(s0.numberLayout === 'random' ? 'random' : 'balanced');
  const [desert, setDesert] = useState(s0.desert === 'center' ? 'center' : 'random');
  const [friendlyRobber, setFriendlyRobber] = useState(s0.friendlyRobber);
  const [balancedDice, setBalancedDice] = useState(s0.balancedDice);
  const [pace, setPace] = useState<'fast' | 'normal'>(s0.pace === 'fast' ? 'fast' : 'normal');
  const [pointsToWin, setPointsToWin] = useState(s0.pointsToWin);
  const [discardLimit, setDiscardLimit] = useState(s0.discardLimit);
  const [seedText, setSeedText] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  const limit = mapLimit(mapKey);
  const occupants = room.players.length;
  const openCount = Math.max(0, limit - occupants);
  const canStart = occupants >= 2; // host + pelo menos 1 (bot ou humano)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Envia um patch de regras ao servidor e adota a sala devolvida. */
  async function patch(fields: Record<string, unknown>) {
    const res = await updateRoomApi(code, fields);
    if (res.ok) onRoom(res.room);
    else onError(res.error);
  }
  /** Igual, mas agrupa mudanças rápidas (sliders). */
  function patchDebounced(fields: Record<string, unknown>) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void patch(fields), 400);
  }

  function chooseMap(key: BoardLayout) {
    if (occupants > mapLimit(key)) return;
    setMapKey(key);
    if (key !== 'standard') setDesert('random');
    void patch({ boardLayout: key });
  }

  async function addBot() {
    if (busy || openCount <= 0) return;
    setBusy(true);
    const used = room.players.map((p) => p.name);
    const res = await addBotApi(code, { name: pickBotName(used).name, difficulty: 'medium' });
    setBusy(false);
    if (res.ok) onRoom(res.room);
    else onError(res.error);
  }
  async function removeBot(color: string) {
    const res = await removeBotApi(code, color);
    if (res.ok) onRoom(res.room);
    else onError(res.error);
  }
  async function setBotDiff(color: string, d: Difficulty) {
    const res = await setBotDifficultyApi(code, color, d);
    if (res.ok) onRoom(res.room);
    else onError(res.error);
  }

  async function start() {
    if (!canStart) return;
    setStarting(true);
    const res = await startRoomApi(code);
    setStarting(false);
    if (res.ok) onRoom(res.room); // status -> in_progress: o Room conecta o WS
    else onError(res.error);
  }

  return (
    <div className="page setup-page">
      <div className="page-head">
        <div>
          <button className="back-link" onClick={onLeave}><ArrowLeft size={15} /> Voltar ao lobby</button>
          <span className="eyebrow">SUA SALA</span>
          <h1>Monte sua mesa.</h1>
        </div>
      </div>

      <LinkCard code={code} />

      <div className="setup-grid">
        <div className="card su-players">
          <h2 className="su-h"><Users size={18} className="ic-primary" /> Jogadores <span className="su-count">{occupants}/{limit}</span></h2>

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
          <p className="su-note">Convide amigos pelo link ou preencha as vagas com bots — jogue de 2 até {limit}.</p>

          {room.players.map((p) => (
            <SeatRow
              key={p.color}
              seat={p}
              onRemove={p.isBot ? () => void removeBot(p.color) : undefined}
              onDifficulty={p.isBot ? (d) => void setBotDiff(p.color, d) : undefined}
            />
          ))}
          {Array.from({ length: openCount }, (_, i) => (
            <OpenSeat key={`open-${i}`} onAddBot={addBot} />
          ))}
        </div>

        <div className="card su-settings">
          <h3 className="su-sub">Tabuleiro</h3>
          <div className="su-tiles">
            <SetupTile icon={<Dices size={20} />} label="Números equilibrados" hint="6 e 8 nunca vizinhos"
              active={numberLayout === 'balanced'}
              onClick={() => {
                const v = numberLayout === 'balanced' ? 'random' : 'balanced';
                setNumberLayout(v);
                void patch({ numberLayout: v });
              }} />
            <SetupTile icon={<Target size={20} />} label="Deserto no centro"
              hint={mapKey === 'standard' ? 'ladrão começa no meio' : 'só no mapa 3–4'}
              disabled={mapKey !== 'standard'}
              active={mapKey === 'standard' && desert === 'center'}
              onClick={() => {
                const v = desert === 'center' ? 'random' : 'center';
                setDesert(v);
                void patch({ desert: v });
              }} />
            <SetupTile icon={<Shield size={20} />} label="Ladrão amigável" hint="não bloqueia quem tem < 3 PV"
              active={friendlyRobber}
              onClick={() => {
                const v = !friendlyRobber;
                setFriendlyRobber(v);
                void patch({ friendlyRobber: v });
              }} />
            <SetupTile icon={<Dices size={20} />} label="Dados balanceados" hint="suaviza sequências de azar"
              active={balancedDice}
              onClick={() => {
                const v = !balancedDice;
                setBalancedDice(v);
                void patch({ balancedDice: v });
              }} />
          </div>

          <h3 className="su-sub">Configurações avançadas</h3>
          <div className="su-pace">
            <label>Ritmo (limite de tempo das ações)</label>
            <div className="su-seg sm">
              <button className={pace === 'normal' ? 'on' : ''} onClick={() => { setPace('normal'); void patch({ pace: 'normal' }); }}>Normal</button>
              <button className={pace === 'fast' ? 'on' : ''} onClick={() => { setPace('fast'); void patch({ pace: 'fast' }); }}>Rápido</button>
            </div>
          </div>
          <div className="su-slider">
            <label>Pontos para vencer <b>{pointsToWin}</b></label>
            <input type="range" min={3} max={15} value={pointsToWin}
              onChange={(e) => { const v = +e.target.value; setPointsToWin(v); patchDebounced({ pointsToWin: v }); }} />
          </div>
          <div className="su-slider">
            <label>Limite de cartas (descarte no 7) <b>{discardLimit}</b></label>
            <input type="range" min={5} max={15} value={discardLimit}
              onChange={(e) => { const v = +e.target.value; setDiscardLimit(v); patchDebounced({ discardLimit: v }); }} />
          </div>
          <div className="su-slider">
            <label>Seed (opcional)</label>
            <div className="su-seed">
              <input value={seedText} placeholder="aleatória"
                onChange={(e) => { setSeedText(e.target.value); patchDebounced({ seed: e.target.value.trim() === '' ? null : hashSeed(e.target.value.trim()) }); }} />
              <button onClick={() => { setSeedText(''); void patch({ seed: null }); }}><Shuffle size={14} /> Aleatória</button>
            </div>
          </div>

          <div className="su-room-online">
            <h3 className="su-sub">Sala</h3>
            <div className="su-slider">
              <label>Nome da sala</label>
              <input
                className="su-roomname"
                value={roomName}
                maxLength={40}
                onChange={(e) => { setRoomName(e.target.value); patchDebounced({ name: e.target.value }); }}
              />
            </div>
            <button
              className={`su-tile su-private${isPrivate ? ' active' : ''}`}
              onClick={() => { const v = !isPrivate; setIsPrivate(v); void patch({ isPrivate: v }); }}
              type="button"
            >
              <span className="su-tile-icon"><Lock size={18} /></span>
              <span className="su-tile-label">Sala privada</span>
              <span className="su-tile-hint">{isPrivate ? 'só por link; fora da listagem' : 'aparece no lobby público'}</span>
            </button>
          </div>

          <button className="cta big su-start" disabled={!canStart || starting} onClick={start}>
            <Play size={16} /> {starting ? 'Iniciando…' : 'Começar partida'}
          </button>
          {!canStart && <p className="su-note">Adicione um bot ou espere um amigo entrar pelo link para começar.</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sala do CONVIDADO: vê a mesa e aguarda o anfitrião                   */
/* ------------------------------------------------------------------ */

function GuestRoom({ code, room, onLeave }: { code: string; room: RoomView; onLeave: () => void }) {
  const openCount = Math.max(0, room.maxPlayers - room.players.length);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="back-link" onClick={onLeave}><ArrowLeft size={15} /> Sair da sala</button>
          <span className="eyebrow">SALA DE ESPERA</span>
          <h1>{room.name} {room.isPrivate && <Lock size={18} className="ic-muted" />}</h1>
        </div>
      </div>

      <LinkCard code={code} />

      <div className="card">
        <h2 className="su-h">
          <Users size={18} className="ic-primary" /> Jogadores
          <span className="su-count">{room.players.length}/{room.maxPlayers}</span>
        </h2>
        <p className="muted-note">Mapa: {MAP_LABEL[room.boardLayout] ?? room.boardLayout}</p>
        <div className="su-players">
          {room.players.map((p) => (
            <SeatRow key={p.color} seat={p} />
          ))}
          {Array.from({ length: openCount }, (_, i) => (
            <OpenSeat key={`open-${i}`} />
          ))}
        </div>
        <p className="muted-note wr-wait">Aguardando o anfitrião iniciar a partida…</p>
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
