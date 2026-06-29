# Deploy — Trevalis (Fly.io + Cloudflare + Neon)

Arquitetura de produção: **um único app Fly** (Node) que serve a SPA buildada,
as rotas de autenticação (`/api/auth/*`, Better Auth), a API (`/api/*`) e o
**WebSocket do jogo** (`/ws`) — tudo na mesma porta/origem. Banco **Postgres no
Neon**. E-mail transacional via **Resend**.

```
Navegador ──HTTPS──> Cloudflare (DNS/proxy) ──> Fly.io (app "trevalis", :8080)
                                                   ├─ SPA estática (apps/web/dist)
                                                   ├─ /api/auth/* (Better Auth)
                                                   ├─ /api/me, /healthz
                                                   └─ /ws (WebSocket do jogo)
                                                          │
                                                          └──> Neon (Postgres)
```

---

## 1. Pré-requisitos (uma vez)

1. **Fly CLI**: instale o `flyctl` e faça login.
   ```bash
   # Windows (PowerShell): iwr https://fly.io/install.ps1 -useb | iex
   fly auth login
   ```
2. **Neon**: crie um projeto Postgres em https://neon.tech e copie a connection
   string (formato `postgresql://USER:PASS@HOST/db?sslmode=require`).
3. **Resend**: crie uma conta em https://resend.com, gere uma API key e
   (depois) verifique o domínio `trevalis.app` para enviar de `no-reply@trevalis.app`.

---

## 2. Criar o app na Fly.io

```bash
# Na raiz do repositório (onde está o fly.toml):
fly apps create trevalis          # cria o app com o nome "trevalis"
# (se o nome estiver tomado, escolha outro e ajuste `app=` no fly.toml)
```

> Não usamos volumes: o estado vive no Postgres (Neon). Nada a persistir no disco.

---

## 3. Secrets (NUNCA no repositório)

```bash
# Gere um segredo forte (use o MESMO valor nos dois):
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   (ou: openssl rand -hex 32)
SECRET=$(openssl rand -hex 32)

fly secrets set \
  DATABASE_URL="postgresql://USER:PASS@HOST/db?sslmode=require" \
  BETTER_AUTH_SECRET="$SECRET" \
  SERVER_SECRET="$SECRET" \
  RESEND_API_KEY="re_xxx" \
  EMAIL_FROM="Trevalis <no-reply@trevalis.app>" \
  --app trevalis
```

As variáveis **não-secretas** (`APP_URL`, `TRUSTED_ORIGINS`, `COOKIE_DOMAIN`,
`NODE_ENV`, `REQUIRE_EMAIL_VERIFICATION`, `PORT`) já estão no `[env]` do `fly.toml`.

| Variável | Onde | Obrigatória |
|---|---|---|
| `DATABASE_URL` | secret | **sim** (o servidor falha no boot sem ela) |
| `BETTER_AUTH_SECRET` | secret | **sim** (assina a sessão) |
| `SERVER_SECRET` | secret | sim (fallback do anterior; use o mesmo valor) |
| `RESEND_API_KEY` | secret | recomendado (sem ela, links só no log) |
| `EMAIL_FROM` | secret/env | recomendado |
| `APP_URL` | env (fly.toml) | sim |
| `TRUSTED_ORIGINS` | env (fly.toml) | sim |
| `COOKIE_DOMAIN` | env (fly.toml) | sim (apex + www) |
| `REQUIRE_EMAIL_VERIFICATION` | env (fly.toml) | opcional |

> **Resend — verifique o domínio antes de exigir confirmação de e-mail.** Para
> enviar de `no-reply@trevalis.app`, adicione o domínio em
> https://resend.com/domains e crie no Cloudflare os registros DNS que o Resend
> mostrar (SPF/DKIM — tipicamente um `TXT` e dois/três `CNAME`/`MX`). Só depois
> vire `REQUIRE_EMAIL_VERIFICATION = "true"` no `fly.toml`. Enquanto isso o
> cadastro/login funcionam; falhas de e-mail são apenas logadas (não bloqueiam).

---

## 4. Deploy

```bash
fly deploy --app trevalis
```

O `[deploy] release_command = "npm run db:migrate"` do `fly.toml` aplica as
**migrations** (idempotente) antes de a nova versão receber tráfego. O health
check do Fly bate em `GET /healthz`.

### Rollback

```bash
fly releases --app trevalis              # lista as versões (vN)
fly deploy --image <imagem-da-versao>    # OU:
fly releases rollback --app trevalis     # volta para a versão anterior
```

### Logs / status / escala

```bash
fly logs --app trevalis
fly status --app trevalis
fly scale count 1 --app trevalis         # nº de máquinas (WS: mantenha >=1)
```

---

## 5. Domínio customizado (trevalis.app + www)

### 5.1. Certificados no Fly

```bash
fly certs add trevalis.app --app trevalis
fly certs add www.trevalis.app --app trevalis
fly ips list --app trevalis              # anote o IPv4 (A) e o IPv6 (AAAA)
```

`fly certs show trevalis.app` mostra exatamente o que falta validar.

### 5.2. Registros DNS no Cloudflare

No painel do Cloudflare (zona `trevalis.app`), crie:

| Tipo | Nome | Conteúdo | Proxy |
|---|---|---|---|
| `A` | `@` | `<IPv4 do fly ips list>` | DNS only (cinza) no 1º deploy* |
| `AAAA` | `@` | `<IPv6 do fly ips list>` | DNS only (cinza)* |
| `CNAME` | `www` | `trevalis.app` | DNS only (cinza)* |

\* **Importante:** deixe **"DNS only" (nuvem cinza)** até os certificados do Fly
ficarem `Ready`. Depois você pode ligar o proxy (nuvem laranja). Se for usar o
proxy do Cloudflare, configure **SSL/TLS → Full (strict)** para não criar loop
de redirect com o `force_https` do Fly.

Para o apex (`@`) o Cloudflare aceita `A/AAAA` apontando para os IPs do Fly.
Alternativa: usar **CNAME flattening** apontando `@` para `trevalis.fly.dev`.

### 5.3. Verificação

```bash
fly certs check trevalis.app --app trevalis
```

Depois, acesse https://trevalis.app e https://www.trevalis.app.

---

## 6. Rodar localmente (produção-like)

```bash
npm install
cp .env.example .env            # preencha DATABASE_URL, SERVER_SECRET, etc.
npm run db:migrate              # aplica migrations no Postgres do .env
npm run build:web               # gera apps/web/dist
npm start                       # servidor único em http://localhost:8080
```

Desenvolvimento (hot reload da SPA + servidor):

```bash
npm run dev          # Vite em :5173 (faz proxy de /api e /ws -> :8080)
npm run dev:server   # servidor Node em :8080 (em outro terminal)
```

Sem `DATABASE_URL`, o jogo (hotseat/bots) roda normalmente; apenas as rotas de
conta (`/api/auth`, `/api/me`) respondem `503`.
