/**
 * Camada HTTP do servidor unico (producao): serve a SPA buildada, as rotas de
 * autenticacao (`/api/auth/*` via Better Auth), `/api/me`, `/healthz` e um
 * fallback de SPA. O WebSocket do jogo e anexado a ESTE mesmo servidor
 * (mesma porta/origem), o que mantem cookies e CSRF simples.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { getAuth } from './auth.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Diretorio com a SPA buildada (apps/web/dist). Configuravel via WEB_DIST. */
const WEB_DIST =
  process.env.WEB_DIST ?? join(__dirname, '..', '..', '..', 'apps', 'web', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(data);
}

/** Serve um arquivo estatico; retorna false se nao existir. */
async function serveFile(res: ServerResponse, filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const buf = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const immutable = filePath.includes(`${join('assets')}`) || /\.[0-9a-f]{8,}\./.test(filePath);
    res.writeHead(200, {
      'content-type': type,
      'cache-control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    res.end(buf);
    return true;
  } catch {
    return false;
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  // --- health check (usado pelo Fly) ---
  if (path === '/healthz' || path === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'trevalis' });
    return;
  }

  // --- autenticacao (Better Auth) ---
  if (path.startsWith('/api/auth')) {
    const auth = getAuth();
    if (!auth) {
      sendJson(res, 503, { error: 'Autenticacao indisponivel (sem banco configurado).' });
      return;
    }
    return toNodeHandler(auth)(req, res);
  }

  // --- perfil do usuario logado ---
  if (path === '/api/me') {
    const auth = getAuth();
    if (!auth) {
      sendJson(res, 503, { error: 'Autenticacao indisponivel.' });
      return;
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      sendJson(res, 401, { error: 'Nao autenticado.' });
      return;
    }
    const u = session.user as typeof session.user & { username?: string | null };
    sendJson(res, 200, {
      id: u.id,
      name: u.name,
      email: u.email,
      username: u.username ?? null,
      avatar: u.image ?? null,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
    });
    return;
  }

  // qualquer outra rota /api/* desconhecida = 404 JSON (nao cai no SPA)
  if (path.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Rota nao encontrada.' });
    return;
  }

  // --- arquivos estaticos da SPA ---
  // Normaliza e impede path traversal para fora de WEB_DIST.
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const target = join(WEB_DIST, rel);
  if (target.startsWith(WEB_DIST)) {
    if (path !== '/' && (await serveFile(res, target))) return;
    // Fallback de SPA: entrega index.html para rotas do cliente (history API).
    if (await serveFile(res, join(WEB_DIST, 'index.html'))) return;
  }

  // Sem build da SPA disponivel (ex.: dev sem `npm run build`).
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404 — recurso nao encontrado.');
}

/** Cria o servidor HTTP (sem ainda escutar). O caller chama `.listen()`. */
export function createHttpServer(): Server {
  return createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[trevalis][http] erro nao tratado:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Erro interno do servidor.' });
      else res.end();
    });
  });
}
