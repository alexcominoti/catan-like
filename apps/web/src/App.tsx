import { useEffect, useState } from 'react';
import { SiteHeader, type Page } from './site/SiteHeader.js';
import { Landing } from './site/Landing.js';
import { RoomBrowser } from './site/RoomBrowser.js';
import { Profile } from './site/Profile.js';
import { Friends } from './site/Friends.js';
import { Auth } from './site/Auth.js';
import { RoomScreen } from './site/RoomScreen.js';
import { authClient } from './auth/client.js';
import { pingPresence } from './site/social.js';

/** Código da sala em `/room/<code>` (ou null se não é um link de sala). */
function roomCodeFromPath(): string | null {
  if (typeof window === 'undefined') return null;
  const m = /^\/room\/([A-Za-z0-9]{4,12})\/?$/.exec(window.location.pathname);
  return m ? m[1]!.toUpperCase() : null;
}

/** Username em `/profile/<username>` (ou null se não é um link de perfil). */
function profileUsernameFromPath(): string | null {
  if (typeof window === 'undefined') return null;
  const m = /^\/profile\/([^/]+)\/?$/.exec(window.location.pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** É a rota do lobby (`/lobby`)? */
function isLobbyPath(): boolean {
  if (typeof window === 'undefined') return false;
  return /^\/lobby\/?$/.test(window.location.pathname);
}

/** É a rota de amigos (`/friends`)? */
function isFriendsPath(): boolean {
  if (typeof window === 'undefined') return false;
  return /^\/friends\/?$/.test(window.location.pathname);
}

/** Deep-link inicial: link de redefinicao de senha, link de sala, link de perfil, lobby, amigos, ou landing. */
function initialPage(): Page {
  if (typeof window === 'undefined') return 'landing';
  if (window.location.pathname.startsWith('/reset-password')) return 'auth';
  if (roomCodeFromPath()) return 'room';
  if (profileUsernameFromPath()) return 'profile';
  if (isFriendsPath()) return 'friends';
  if (isLobbyPath()) return 'lobby';
  return 'landing';
}

/** Sincroniza a barra de endereços com a página atual (link compartilhável). */
function syncUrl(page: Page, roomCode: string | null, profileUsername: string | null) {
  if (typeof window === 'undefined') return;
  let target = '/';
  if (page === 'room' && roomCode) target = `/room/${roomCode}`;
  else if (page === 'profile' && profileUsername) target = `/profile/${encodeURIComponent(profileUsername)}`;
  else if (page === 'friends') target = '/friends';
  else if (page === 'lobby') target = '/lobby';
  if (window.location.pathname !== target) {
    window.history.pushState({}, '', target);
  }
}

export function App() {
  const [page, setPage] = useState<Page>(initialPage);
  const [roomCode, setRoomCode] = useState<string | null>(roomCodeFromPath);
  const [profileUsername, setProfileUsername] = useState<string | null>(profileUsernameFromPath);
  // Sala pendente: se o usuário precisar logar para entrar, voltamos a ela depois.
  const [pendingRoom, setPendingRoom] = useState<string | null>(roomCodeFromPath);
  // A partida ao vivo (online) ocupa a tela inteira, sem o header do site.
  const [roomFullscreen, setRoomFullscreen] = useState(false);
  const { data: session } = authClient.useSession();

  // Heartbeat de presença: enquanto logado, avisa o servidor a cada 30s que está
  // online (com a sala atual, se houver) — alimenta o contador da landing e o
  // status online dos amigos. Ver apps/web/src/site/social.ts.
  useEffect(() => {
    if (!session?.user) return;
    const currentRoom = () => (page === 'room' ? roomCode : null);
    void pingPresence(currentRoom());
    const id = setInterval(() => void pingPresence(currentRoom()), 30_000);
    return () => clearInterval(id);
  }, [session?.user?.id, page, roomCode]);

  // Botões voltar/avançar do navegador: relê a URL.
  useEffect(() => {
    function onPop() {
      const code = roomCodeFromPath();
      const username = profileUsernameFromPath();
      if (code) {
        setRoomCode(code);
        setPage('room');
      } else if (username) {
        setProfileUsername(username);
        setPage('profile');
      } else if (window.location.pathname.startsWith('/reset-password')) {
        setPage('auth');
      } else if (isFriendsPath()) {
        setRoomCode(null);
        setPage('friends');
      } else if (isLobbyPath()) {
        setRoomCode(null);
        setPage('lobby');
      } else {
        setRoomCode(null);
        setPage('landing');
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Navegação central: troca de página e mantém a URL coerente. `param` = código da sala ou username, conforme a página. */
  function nav(p: Page, param: string | null = null) {
    const nextRoomCode = p === 'room' ? param : null;
    const nextProfileUsername = p === 'profile' ? param : null;
    setRoomCode(nextRoomCode);
    setProfileUsername(nextProfileUsername);
    setPage(p);
    syncUrl(p, nextRoomCode, nextProfileUsername);
  }

  function enterRoom(code: string) {
    nav('room', code);
  }

  // A sala ao vivo (online) tambem some com o header quando esta em tela cheia —
  // mas o RoomScreen fica montado continuamente (sem isso, a troca perderia a conexao WS).
  const roomIsFullscreen = page === 'room' && roomFullscreen;

  return (
    <div className={`site${roomIsFullscreen ? ' site-fullscreen' : ''}`}>
      {!roomIsFullscreen && <SiteHeader page={page} onNav={(p, param) => nav(p, param ?? null)} />}
      {page === 'landing' && <Landing onPlay={() => nav('lobby')} onWatch={() => nav('lobby')} />}
      {page === 'lobby' && (
        <RoomBrowser
          onCreate={() => nav('room')}
          onEnterRoom={enterRoom}
          onNeedAuth={() => nav('auth')}
        />
      )}
      {page === 'room' && (
        <RoomScreen
          code={roomCode}
          onRoomCreated={enterRoom}
          onLeave={() => nav('lobby')}
          onNeedAuth={() => { setPendingRoom(roomCode); nav('auth'); }}
          onFullscreenChange={setRoomFullscreen}
        />
      )}
      {page === 'profile' && (
        <Profile
          username={profileUsername ?? undefined}
          onOwnUsername={(u) => setProfileUsername(u)}
          onNeedAuth={() => nav('auth')}
        />
      )}
      {page === 'friends' && (
        <Friends onEnterRoom={enterRoom} onNeedAuth={() => nav('auth')} />
      )}
      {page === 'auth' && (
        <Auth onAuthed={() => (pendingRoom ? enterRoom(pendingRoom) : nav('lobby'))} />
      )}
    </div>
  );
}
