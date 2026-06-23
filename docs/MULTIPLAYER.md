# Jogar online com amigos — Fase 2 (plano + hospedagem)

> **Estado atual:** o jogo é **local** (1 computador) — hotseat + bots. Para jogar
> com amigos em máquinas diferentes falta a **Fase 2**: um servidor autoritativo
> em tempo real. Este documento é o plano para construí-la e o passo-a-passo de
> como hospedar.

## Por que precisa de um servidor

O motor (`packages/engine`) já é **autoritativo e determinístico**: dado o mesmo
estado + ação, todos chegam ao mesmo resultado. Falta só uma camada de **rede**
que: (1) recebe ações dos jogadores, (2) valida pelo `reduce`, (3) transmite o
novo estado a todos. Como o motor não tem I/O, ele roda **igual** no navegador
(hoje) e no servidor (Fase 2) sem reescrever regra nenhuma.

## Arquitetura proposta (mínima e barata)

```
Navegador do amigo ─┐
Navegador do amigo ─┼─ WebSocket ─→  Servidor Node (ws) ──→ reduce() do engine
Seu navegador ──────┘                  • 1 sala = 1 GameState
                                       • valida turno/dono da ação
                                       • projeta o estado (fog of war: esconde a
                                         mão dos outros) e faz broadcast
```

- **`packages/server`** (novo): Node + [`ws`](https://github.com/websockets/ws).
  Mantém `Map<roomId, GameState>`; ao receber `{roomId, action}`, confere se é a
  vez/dono, chama `reduce`, e envia `projectFor(state, color)` a cada jogador.
- **`projectFor(state, color)`**: oculta a mão e as cartas de progresso dos
  adversários (já temos a contagem pública). Anti-trapaça grátis.
- **Reconexão:** como tudo é o `GameState` + a seed, basta reenviar o estado atual
  ao reconectar. Persistir em SQLite (Fase 3) permite sobreviver a reinícios.
- **Lobby real:** criar sala gera um `roomId`; o link `…/sala/ABC123` entra nela.
  As "vagas abertas" do lobby atual passam a ser preenchidas por quem entra.

## Passo-a-passo: como hospedar para jogar com amigos

### Opção A — Túnel rápido (teste no mesmo dia, grátis)
Roda o servidor no **seu PC** e expõe pela internet com um túnel. Bom para uma
noite de jogo; seu PC precisa ficar ligado.

1. (depois da Fase 2 pronta) `npm run server` — sobe o servidor na porta 8080.
2. Instale um túnel, ex.: `npm i -g localtunnel` e rode `lt --port 8080`
   (ou [ngrok](https://ngrok.com): `ngrok http 8080`).
3. O túnel te dá uma URL pública (ex.: `https://algo.loca.lt`). Seus amigos abrem
   essa URL no navegador e entram na sua sala pelo link.
4. Fim do jogo: feche o túnel. (Nada fica hospedado.)

### Opção B — Hospedagem na nuvem (persistente, ~grátis/baixo custo)
Para deixar "no ar" sem depender do seu PC:

1. **Frontend** (`apps/web`): `npm run build` gera estáticos → publique de graça na
   **Vercel**, **Netlify** ou **Cloudflare Pages** (conecta no repo do GitHub e faz
   deploy automático a cada push).
2. **Servidor WebSocket** (`packages/server`): precisa de um host que aceite
   conexões persistentes — **Render**, **Railway**, **Fly.io** ou uma VPS barata
   (Hetzner/DigitalOcean ~US$5/mês). Faz deploy do Node; ele escuta `wss://`.
3. Aponte o frontend para a URL do servidor (variável `VITE_SERVER_URL`).
4. Amigos acessam a URL do frontend (ex.: `https://hexkeep.vercel.app`), criam/
   entram numa sala e jogam — você não precisa ficar com o PC ligado.

### Recomendação
Comece pela **Opção A** (túnel) assim que a Fase 2 existir, para validar o
multiplayer com os amigos sem custo. Quando quiser algo permanente, **Opção B**
com Vercel (frontend) + Fly.io/Render (servidor) é o caminho mais barato.

## Ordem de implementação da Fase 2 — progresso
1. ✅ **`projectFor(state, color)`** no engine (fog of war): esconde a composição da
   mão e as cartas dos adversários (mantém só as contagens em `hiddenHand`/
   `hiddenDevCount`), a ordem do baralho (`devDeckCount`) e a semente do PRNG.
   Testado em `packages/engine/test/project.test.ts`.
2. ✅ **`packages/server`** (Node + `ws`): `GameRoom` autoritativo — valida cada ação
   pelo `reduce`, auto-joga os bots e projeta o estado por jogador; `RoomManager`
   por id; servidor WebSocket em `src/index.ts`. Testado (sala só de bots termina
   sozinha; espera a vez do humano; rejeita ação ilegal; projeção esconde info).
   Rodar: `npm run server` (porta 8080, configurável por `PORT`).
3. ⏳ Cliente: camada de transporte — quando online, o `Game.tsx` envia a ação ao
   servidor (mensagem `action`) e renderiza o `state` projetado recebido, em vez do
   `dispatch` local. Como já fala via `reduce`, muda pouco.
4. ⏳ Lobby real com `roomId` + link de convite (as vagas abertas viram jogadores que
   entram pela mensagem `join`). O lobby atual já modela host + vagas + bots.
5. ⏳ Reconexão (reenviar o estado projetado ao reconectar); depois SQLite (Fase 3).
