import './load-env.js'; // carrega o .env da raiz ANTES de qualquer import ler process.env
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

/**
 * Rede de seguranca do PROCESSO. Uma promise rejeitada sem catch derruba o Node
 * por padrao — e com uma maquina so isso interrompe todas as partidas vivas.
 * Uma falha isolada (uma acao esquisita, uma query que caiu) tem que virar log,
 * nao queda: registramos e seguimos. `uncaughtException` e diferente — dali em
 * diante o estado do processo e duvidoso, entao registramos e saimos para o Fly
 * subir uma instancia limpa (as partidas voltam pelo snapshot).
 */
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[trevalis] promise rejeitada sem tratamento:', reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[trevalis] FATAL: excecao nao capturada, reiniciando:', err);
  process.exit(1);
});

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
