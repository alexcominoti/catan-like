import { useEffect, useState } from 'react';
import { Lobby, type GameConfig, type GameSetup } from './ui/Lobby.js';
import { randomSeed } from './game/seed.js';
import { Game } from './Game.js';
import { SiteHeader, type Page } from './site/SiteHeader.js';
import { Landing } from './site/Landing.js';
import { RoomBrowser } from './site/RoomBrowser.js';
import { Profile } from './site/Profile.js';
import { Auth } from './site/Auth.js';
import { WaitingRoom } from './site/WaitingRoom.js';

/** Código da sala em `/sala/<code>` (ou null se não é um link de sala). */
function roomCodeFromPath(): string | null {
  if (typeof window === 'undefined') return null;
  const m = /^\/sala\/([A-Za-z0-9]{4,12})\/?$/.exec(window.location.pathname);
  return m ? m[1]!.toUpperCase() : null;
}

/** Deep-link inicial: link de redefinicao de senha, link de sala, ou landing. */
function initialPage(): Page {
  if (typeof window === 'undefined') return 'landing';
  if (window.location.pathname.startsWith('/reset-password')) return 'auth';
  if (roomCodeFromPath()) return 'room';
  return 'landing';
}

/** Sincroniza a barra de endereços com a página atual (link compartilhável). */
function syncUrl(page: Page, roomCode: string | null) {
  if (typeof window === 'undefined') return;
  const target = page === 'room' && roomCode ? `/sala/${roomCode}` : '/';
  if (window.location.pathname !== target) {
    window.history.pushState({}, '', target);
  }
}

export function App() {
  const [page, setPage] = useState<Page>(initialPage);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(roomCodeFromPath);
  // Sala pendente: se o usuário precisar logar para entrar, voltamos a ela depois.
  const [pendingRoom, setPendingRoom] = useState<string | null>(roomCodeFromPath);

  // Botões voltar/avançar do navegador: relê a URL.
  useEffect(() => {
    function onPop() {
      const code = roomCodeFromPath();
      if (code) {
        setRoomCode(code);
        setPage('room');
      } else if (window.location.pathname.startsWith('/reset-password')) {
        setPage('auth');
      } else {
        setRoomCode(null);
        setPage('landing');
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Navegação central: troca de página e mantém a URL coerente. */
  function nav(p: Page, code: string | null = null) {
    setRoomCode(code);
    setPage(p);
    syncUrl(p, code);
  }

  function enterRoom(code: string) {
    nav('room', code);
  }

  // O jogo ocupa a tela inteira (sem o header do site).
  if (page === 'game' && config) {
    return <Game key={config.seed} config={config} onExit={() => { setConfig(null); nav('lobby'); }} />;
  }

  return (
    <div className="site">
      <SiteHeader page={page} onNav={(p) => nav(p)} />
      {page === 'landing' && <Landing onPlay={() => nav('lobby')} onWatch={() => nav('lobby')} />}
      {page === 'lobby' && (
        <RoomBrowser
          onCreate={() => nav('setup')}
          onEnterRoom={enterRoom}
          onNeedAuth={() => nav('auth')}
        />
      )}
      {page === 'setup' && (
        <Lobby
          onStartLocal={(setup: GameSetup) => {
            setConfig({ ...setup, seed: setup.seed ?? randomSeed() });
            nav('game');
          }}
          onRoomCreated={(code, setup) => {
            setConfig({ ...setup, seed: setup.seed ?? randomSeed() });
            enterRoom(code);
          }}
          onBack={() => nav('lobby')}
        />
      )}
      {page === 'room' && roomCode && (
        <WaitingRoom
          code={roomCode}
          localConfig={config}
          onStartGame={(cfg) => { setConfig(cfg); nav('game'); }}
          onLeave={() => nav('lobby')}
          onNeedAuth={() => { setPendingRoom(roomCode); nav('auth'); }}
        />
      )}
      {page === 'profile' && <Profile />}
      {page === 'auth' && (
        <Auth onAuthed={() => (pendingRoom ? enterRoom(pendingRoom) : nav('lobby'))} />
      )}
    </div>
  );
}
