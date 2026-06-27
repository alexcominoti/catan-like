import { useState } from 'react';
import { Lobby, type GameConfig, type GameSetup } from './ui/Lobby.js';
import { randomSeed } from './game/seed.js';
import { Game } from './Game.js';
import { SiteHeader, type Page } from './site/SiteHeader.js';
import { Landing } from './site/Landing.js';
import { RoomBrowser } from './site/RoomBrowser.js';
import { Profile } from './site/Profile.js';

export function App() {
  const [page, setPage] = useState<Page>('landing');
  const [config, setConfig] = useState<GameConfig | null>(null);

  // O jogo ocupa a tela inteira (sem o header do site).
  if (page === 'game' && config) {
    return <Game key={config.seed} config={config} onExit={() => { setConfig(null); setPage('lobby'); }} />;
  }

  return (
    <div className="site">
      <SiteHeader page={page} onNav={setPage} />
      {page === 'landing' && <Landing onPlay={() => setPage('lobby')} onWatch={() => setPage('lobby')} />}
      {page === 'lobby' && <RoomBrowser onPlay={() => setPage('setup')} />}
      {page === 'setup' && (
        <Lobby
          onStart={(setup: GameSetup) => {
            // Resolve a seed aleatoria (crypto) aqui, fora do lobby.
            setConfig({ ...setup, seed: setup.seed ?? randomSeed() });
            setPage('game');
          }}
          onBack={() => setPage('lobby')}
        />
      )}
      {page === 'profile' && <Profile />}
    </div>
  );
}
