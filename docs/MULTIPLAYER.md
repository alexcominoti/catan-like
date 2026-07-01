# Jogar online com amigos — Fase 2 (plano + hospedagem)

> **Estado atual:** a Fase 2 está **PRONTA e ligada de ponta a ponta** — servidor
> autoritativo (`@trevalis/server` GameRoom/RoomManager) conectado ao cliente
> (`net/client.ts` + `Game.tsx` modo `online`), com salas em `/room/<code>`,
> reconexão por conta, bot-takeover com graça e limpeza de sala vazia. O modo
> **local** (hotseat/bots, 1 computador, sem link) continua existindo à parte, sem
> URL, para quem quer jogar rápido sem convidar ninguém. Este documento continua
> valendo como referência de arquitetura + passo-a-passo de hospedagem; a seção
> "Ordem de implementação" abaixo está com o progresso atualizado.

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
4. Amigos acessam a URL do frontend (ex.: `https://trevalis.vercel.app`), criam/
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
3. ✅ Cliente — transporte: `apps/web/src/net/client.ts` (`GameClient`: connect/
   enter/send + callbacks onState/onJoined/onError/onDisconnected/onReconnected,
   com reconexão automática por backoff). **Ligado ao `Game.tsx`**: prop opcional
   `online` — quando presente, `dispatch` envia a ação pelo `GameClient` e a UI
   renderiza o `state` projetado que chega do servidor; o loop de bots e o
   `reduce` locais ficam desligados (o servidor manda); contagens dos oponentes
   via `hiddenHand`; indicador "🤖 assumiu" via `awayColors`.
4. ✅ Lobby real com `code` (o mesmo id do link `/room/<code>`) + link de convite —
   `RoomManager` (server) agora é indexado pelo `code`; `apps/web/src/site/
   RoomScreen.tsx` unifica "Monte sua mesa" + a antiga "Sala de Espera" (o link
   aparece na hora, sem trocar de tela); vagas abertas viram jogadores reais que
   entram via `POST /api/rooms/:code/join`.
5. ✅ Reconexão por CONTA (não só sessão local): assentos são identificados por
   `userId` (login obrigatório), então reabrir o link em outro aparelho reocupa o
   mesmo assento. Grace period de 15s antes do bot-takeover (`RECONNECT_GRACE_MS`
   em `room.ts`). Espectadores (quem não é membro entra em modo leitura via
   `projectForSpectator`). Limpeza de sala vazia (5 min sem humano conectado →
   `abandoned`, sweep a cada 30s). Persistência do `GameState` em disco (sobreviver
   a um restart do processo) continua pendente — ver `docs/backlog.md`.

### Robustez de servidor já implementada
- ✅ **Ritmo Rápido/Normal** (`pace` na config): limites de tempo por ação
  (`PACE_TIMERS`, inspirados no Colonist). `GameRoom.deadlineSeconds()` diz quanto
  tempo a janela atual tem; ao estourar, `forceTimeout()` resolve assim (alinhado):
  - **Fase principal** (turno livre): **só passa a vez** (endTurn). Conta como turno
    perdido; após **3 timeouts seguidos** a vaga **vira bot médio** (AFK). Agir
    manualmente zera o contador.
  - **Rolar / descartar / mover ladrão / setup**: não dá para pular → um **bot
    resolve** a obrigação por ele (uma vez).
  - **Oferta de troca ativa** (inclui bot→humano): fecha/cancela via
    `resolveBotProposal`. (Fechou a lacuna anterior.)
  O servidor agenda o `setTimeout` por sala e re-emite o estado ao disparar.
- ✅ **Desconexão → bot médio (com graça)**: ao cair, espera `RECONNECT_GRACE_MS`
  (15s) — reconectar antes cancela; se estourar, a vaga vira bot médio e assume.
  Heartbeat ws ping/pong (10s) detecta quedas silenciosas (sem `close` limpo). Se o
  jogador voltar (`seat`, pela conta/`userId`), ele reassume o controle.

### Contas / login
Plano e passos de setup do **Google OAuth** em [`AUTH.md`](AUTH.md) (precisa de
credenciais criadas por você no Google Cloud).
