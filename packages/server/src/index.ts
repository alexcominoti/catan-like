import 'dotenv/config';
import { createHttpServer } from './http.js';
import { attachGameServer, RoomManager, WS_PATH } from './server.js';

/**
 * Entrada de PRODUCAO: um unico processo Node servindo HTTP (SPA + auth + API)
 * e o WebSocket do jogo na MESMA porta/origem. Rodar com `npm run server`
 * (raiz) ou `npm start -w @trevalis/server`.
 */

/** Falha rapido (exit 1) se faltar configuracao obrigatoria de producao. */
function requireEnv(): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.SERVER_SECRET && !process.env.BETTER_AUTH_SECRET) {
    missing.push('SERVER_SECRET (ou BETTER_AUTH_SECRET)');
  }
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[trevalis] FATAL: variaveis de ambiente obrigatorias ausentes: ${missing.join(', ')}.\n` +
        'Defina-as no .env (dev) ou via `fly secrets set` (producao).',
    );
    process.exit(1);
  }
}

requireEnv();

const port = Number(process.env.PORT ?? 8080);
// RoomManager compartilhado: a rota HTTP /start liga o GameRoom nele, o WS ja
// encontra a partida rodando quando o jogador entra por `enter`.
const manager = new RoomManager();
const server = createHttpServer(manager);
attachGameServer(server, { manager });

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[trevalis] servidor ouvindo em http://localhost:${port} (WebSocket em ${WS_PATH})`,
  );
});
