import { useState } from 'react';
import { Lobby, type GameConfig } from './ui/Lobby.js';
import { Game } from './Game.js';

export function App() {
  const [config, setConfig] = useState<GameConfig | null>(null);

  if (!config) return <Lobby onStart={setConfig} />;
  // key={config.seed} garante um Game novo (estado zerado) a cada partida.
  return <Game key={config.seed} config={config} onExit={() => setConfig(null)} />;
}
