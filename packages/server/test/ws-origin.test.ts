/**
 * Handshake do WebSocket contra origem cruzada (CSWSH) — o caminho de PRODUÇÃO.
 *
 * `ws.test.ts` sobe o servidor por `startServer`, que não passa por
 * `verifyClient`. Quem roda em produção é o `attachGameServer` (HTTP e WS na
 * mesma porta), e é ele que carrega a checagem de `Origin`. Sem um teste aqui, a
 * regra que decide quem consegue jogar não é exercida por nada.
 *
 * O risco é dos dois lados e por isso os dois estão fixados: apertado demais
 * derruba TODO jogador legítimo (o navegador sempre manda `Origin`); frouxo
 * demais reabre o CSWSH, em que uma página qualquer abre um socket que o
 * navegador autentica com o cookie da vítima.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket, type WebSocketServer } from 'ws';
import { attachGameServer, WS_PATH } from '../src/server.js';
import { RoomManager } from '../src/room.js';

const APP_ORIGIN = 'https://trevalis.app';

let http: Server;
let wss: WebSocketServer;
let port: number;

beforeAll(async () => {
  process.env.NODE_ENV = 'production'; // sem os atalhos de localhost do dev
  process.env.APP_URL = APP_ORIGIN;
  http = createServer();
  wss = attachGameServer(http, {
    manager: new RoomManager(),
    resolveUserId: async () => 'user-red',
    roomExists: async () => true,
  });
  await new Promise<void>((res) => http.listen(0, () => res()));
  const addr = http.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(async () => {
  wss.close();
  await new Promise<void>((res) => http.close(() => res()));
});

/** Tenta o handshake e diz se ele foi aceito. */
function handshake(origin?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}${WS_PATH}`, origin ? { origin } : {});
    let respondido = false;
    const done = (ok: boolean) => {
      if (respondido) return; // o socket recusado ainda emite 'error' depois
      respondido = true;
      resolve(ok);
      ws.terminate();
    };
    // Os tratadores ficam ATÉ O FIM de propósito: derrubar o socket dispara um
    // 'error' tardio, e sem ouvinte ele viraria erro não tratado no teste.
    ws.on('open', () => done(true));
    ws.on('error', () => done(false));
    ws.on('unexpected-response', () => done(false));
  });
}

describe('WebSocket: origem no handshake', () => {
  it('aceita a origem do próprio app (o jogador de verdade)', async () => {
    expect(await handshake(APP_ORIGIN)).toBe(true);
  });

  it('recusa origem de outro site (CSWSH)', async () => {
    expect(await handshake('https://evil.com')).toBe(false);
  });

  it('recusa host que apenas COMEÇA igual', async () => {
    expect(await handshake('https://trevalis.app.evil.com')).toBe(false);
  });

  it('aceita cliente sem Origin (loadtest, cliente nativo)', async () => {
    expect(await handshake()).toBe(true);
  });
});
