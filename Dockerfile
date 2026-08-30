# syntax=docker/dockerfile:1
# Imagem de producao do Trevalis: 1 processo Node servindo SPA + auth/API + WebSocket.
#
# Tres estagios: (1) instala TUDO e builda a SPA; (2) instala so as deps de
# producao; (3) junta o build com essas deps e roda como usuario sem privilegio.
#
# Por que separar o estagio 2: antes a imagem final levava `node_modules`
# inteiro — vite, vitest, esbuild, drizzle-kit, typescript — que so servem para
# build e teste. Era superficie de ataque (e os alertas do `npm audit`) viajando
# junto para producao sem necessidade. O `tsx` fica em `dependencies` de
# proposito: e ele que roda o servidor e as migrations.

# ---------- 1. build da SPA ----------
FROM node:22-slim AS build
WORKDIR /app

# Manifests primeiro (cache de camadas do npm ci).
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/bot/package.json packages/bot/
COPY packages/server/package.json packages/server/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN npm ci

# Codigo + build da SPA (gera apps/web/dist).
COPY . .
RUN npm run build:web

# ---------- 2. dependencias de producao ----------
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/bot/package.json packages/bot/
COPY packages/server/package.json packages/server/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev
# `--omit=dev` sozinho nao basta: em monorepo com workspaces linkados o npm
# marca as devDependencies dos pacotes como producao (vite/vitest entram por
# ai), e o drizzle-kit vem pendurado no proprio better-auth. Nada disso roda em
# producao — o servidor sobe com `tsx`, que traz o esbuild PROPRIO em
# node_modules/tsx/node_modules (por isso apagar o esbuild de cima e seguro).
# Sao justamente os pacotes que aparecem no `npm audit`. Poda ~50MB.
RUN rm -rf node_modules/vite node_modules/vitest node_modules/@vitest \
    node_modules/vite-node node_modules/drizzle-kit node_modules/@esbuild-kit \
    node_modules/postcss node_modules/rollup node_modules/@rollup \
    node_modules/@vitejs node_modules/esbuild node_modules/@esbuild \
    node_modules/typescript

# ---------- 3. runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Sem privilegio: se algo escapar do processo, escapa como `node`, nao como root.
USER node

EXPOSE 8080
# Health check do proprio container (alem do check do Fly).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start", "--workspace", "@trevalis/server"]
