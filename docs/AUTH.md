# Contas e login (Google OAuth) — plano e setup

> Decisão: **OAuth real do Google** (escolha do usuário). Login só com Google por
> agora; ao primeiro acesso o usuário escolhe um **username único**; e-mail/senha
> fica para depois. O perfil mostra **dados reais** (username, avatar do Google,
> estatísticas).
>
> ⚠️ Para implementar e TESTAR de verdade eu preciso que você crie as credenciais
> no Google Cloud (só você pode) e me passe o **Client ID** (o Secret fica no
> servidor, via variável de ambiente — não no repositório).

## Arquitetura escolhida

- **Backend**: estender `packages/server` para servir **HTTP (REST)** no mesmo
  processo Node, compartilhando a porta com o WebSocket. Sem framework pesado
  (Node `http` + `fetch` nativo do Node 24).
- **Fluxo**: OAuth2 **Authorization Code** do Google:
  1. `GET /auth/google/login` → redireciona para o Google (scopes `openid email profile`).
  2. Google volta em `GET /auth/google/callback?code=...&state=...`.
  3. Servidor troca o `code` por tokens em `oauth2.googleapis.com/token`.
  4. Servidor lê o perfil em `googleapis.com/oauth2/v3/userinfo` (`sub`, `email`, `name`, `picture`).
  5. **Upsert** do usuário pelo `sub` do Google. Se ainda não tem username → o web
     mostra a tela de **escolher username** (`POST /api/username`, com checagem de
     unicidade no servidor).
  6. Sessão via **cookie httpOnly assinado** (HMAC com `SERVER_SECRET`).
- **Armazenamento**: começa com um **arquivo JSON** (`data/users.json`) — simples e
  "dados reais" o suficiente para a Fase 2/4 inicial. Migra para SQLite/Postgres
  na Fase 3/4 (persistência de verdade + estatísticas de partidas).
- **Perfil**: `GET /api/me` devolve `{ username, name, picture, createdAt, stats }`.
  O web usa isso na página de Perfil (hoje mock) e no header.

## O que VOCÊ precisa fazer no Google Cloud (uma vez)

1. Acesse https://console.cloud.google.com e crie um **projeto** (ex.: "Hexkeep").
2. **APIs e Serviços → Tela de consentimento OAuth**: tipo **External**; preencha
   nome do app e e-mail; em "Usuários de teste" adicione o seu e-mail (e dos amigos
   que forem testar antes de publicar).
3. **APIs e Serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**.
   - **URIs de redirecionamento autorizados**:
     - Dev: `http://localhost:8080/auth/google/callback`
     - Produção (quando hospedar): `https://SEU_DOMINIO/auth/google/callback`
   - (Origens JavaScript autorizadas, se pedir: `http://localhost:5173` em dev.)
4. Copie o **Client ID** e o **Client Secret**.

## Variáveis de ambiente do servidor (eu configuro o uso)

```
GOOGLE_CLIENT_ID=...          # pode me passar (vai no front também)
GOOGLE_CLIENT_SECRET=...      # SEGREDO — só no servidor, nunca no repo
OAUTH_REDIRECT_URI=http://localhost:8080/auth/google/callback
SERVER_SECRET=<aleatório longo p/ assinar a sessão>
WEB_ORIGIN=http://localhost:5173
```

Guardar num `.env` (no `.gitignore`) ou nas variáveis do host (Render/Fly.io).

## Próximos passos (depende de você criar as credenciais)
1. Você cria o OAuth client e me passa o **Client ID** (+ define o Secret no `.env`).
2. Eu implemento: `packages/server` HTTP + `/auth/google/*` + `/api/me` + `/api/username`
   + store de usuários + sessão; no web: botão **"Entrar com Google"**, tela de
   **username único**, e a página de **Perfil com dados reais**.
3. Testamos o login de ponta a ponta em dev (localhost) antes de hospedar.
