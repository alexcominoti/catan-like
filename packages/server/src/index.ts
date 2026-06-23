import { startServer } from './server.js';

/** Entrada do servidor: `npm run server` (raiz) ou `npm start -w @hexgame/server`. */
const wss = startServer();
wss.on('listening', () => {
  const addr = wss.address();
  const port = typeof addr === 'object' && addr ? addr.port : addr;
  // eslint-disable-next-line no-console
  console.log(`[hexgame] servidor WebSocket ouvindo em ws://localhost:${port}`);
});
