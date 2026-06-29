# syntax=docker/dockerfile:1
# Imagem de producao do Trevalis: 1 processo Node servindo SPA + auth/API + WebSocket.
# Multi-stage: instala deps + builda a SPA; a imagem final roda o servidor (tsx).

# ---------- build ----------
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

# ---------- runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

# Copia tudo (codigo + node_modules + dist) do estagio de build.
COPY --from=build /app ./

EXPOSE 8080
# Health check do proprio container (alem do check do Fly).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start", "--workspace", "@trevalis/server"]
