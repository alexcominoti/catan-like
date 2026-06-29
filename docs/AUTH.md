# Contas e autenticação (Better Auth)

> Decisão: **Better Auth** (e-mail + senha) sobre **Postgres (Neon)** via Drizzle.
> Escolhido por ser TypeScript-nativo, agnóstico de framework (encaixa no nosso
> servidor Node + SPA Vite, sem Next.js), self-hosted (sem vendor) e por já
> trazer sessões, CSRF, rate limiting e hash de senha moderno (scrypt) prontos.

## Arquitetura

- **Servidor único** (`packages/server`): HTTP (`src/http.ts`) serve a SPA, as
  rotas de auth e a API; o WebSocket do jogo é anexado à **mesma porta/origem**
  (cookies e CSRF ficam triviais). Ver [`DEPLOY.md`](DEPLOY.md).
- **Better Auth** (`packages/server/src/auth.ts`): montado em `/api/auth/*` via
  `toNodeHandler`. Carga **preguiçosa** — só existe quando há `DATABASE_URL`
  (sem banco, o jogo roda e as rotas de conta respondem `503`).
- **Banco** (`packages/db`): Drizzle + Postgres. Tabelas do Better Auth
  (`user`, `session`, `account`, `verification`) + tabelas de produto prontas
  para o futuro (amigos, partidas, ranking, estatísticas, inventário,
  conquistas). Migrations em `packages/db/migrations`.
- **E-mail** (`packages/server/src/mailer.ts`): Resend, _env-gated_. Sem
  `RESEND_API_KEY`, os links de confirmação/redefinição são apenas logados.
- **Cliente** (`apps/web/src/auth/client.ts`): `createAuthClient` do
  `better-auth/react`; a tela `site/Auth.tsx` cobre login, cadastro, recuperação
  e redefinição de senha. O header mostra o usuário logado e o botão "Sair".

## Fluxos cobertos

| Fluxo | Endpoint (cliente) | Observação |
|---|---|---|
| Cadastro | `authClient.signUp.email` | dispara e-mail de confirmação |
| Login | `authClient.signIn.email` | sessão por cookie httpOnly assinado |
| Logout | `authClient.signOut` | |
| Recuperar senha | `authClient.requestPasswordReset` | e-mail com link `/reset-password?token=` |
| Redefinir senha | `authClient.resetPassword` | lê o token da URL |
| Confirmar e-mail | link `/api/auth/verify-email` | `sendOnSignUp: true` |
| Perfil | `GET /api/me` | id, nome, e-mail, avatar, username, createdAt |

## Segurança

- **Senha**: hash scrypt (padrão do Better Auth), mínimo 8 caracteres.
- **Sessão**: cookie `httpOnly`, `sameSite=lax`, `secure` em produção; expira em
  30 dias, renova a cada dia de uso.
- **CSRF**: validação de origem por `trustedOrigins` (apex + www + `WEB_ORIGIN`).
- **Rate limiting**: embutido (janela de 60s); o Better Auth aplica limites
  menores nos endpoints sensíveis (login).
- **Segredos**: `SERVER_SECRET` e `DATABASE_URL` só via ambiente/secret — nunca
  no repositório.

## Próximos passos (produto)

- Tela de **username único** no primeiro acesso (coluna `username` já existe).
- Ligar o `Game.tsx` ao servidor autoritativo (`net/client.ts` → `/ws`) usando a
  sessão para identificar o jogador.
- Popular `player_stats` / `match` ao fim de cada partida (ranking e histórico).
- Login social (Google/Discord) — Better Auth suporta; basta adicionar provider
  + secrets, sem mudar o resto.
