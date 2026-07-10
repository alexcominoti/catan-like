# Backlog — funcionalidades removidas de produção (temporariamente)

Este arquivo registra conteúdo que estava **mockado** (dados falsos) ou prometia algo
que ainda não existe, e por isso foi **removido da produção** até termos a implementação
real. Para cada item: **o que era**, **por que saiu** e **o que falta para voltar**.

> Convenção: ao remover algo mockado da UI, deixe um comentário no código apontando
> para a entrada correspondente aqui.

---

## Landing (página inicial)

### Contagem de "jogadores online" — FEITO (Tier 1, item 4)
- **O que era:** o selo "12,4k jogadores online" na seção de prova social, abaixo dos
  CTAs (`apps/web/src/site/Landing.tsx`, `.hero-stats`).
- **O que é agora:** número REAL de jogadores online, via serviço de presença em
  memória (`packages/server/src/presence.ts` = `PresenceTracker`). O cliente logado
  faz um heartbeat a cada 30s (`POST /api/presence/ping`, com a sala atual se houver);
  a landing consome `GET /api/presence` (público). Uma entrada expira após 60s sem
  heartbeat. Também alimenta o status online/sala dos amigos (ver Amigos abaixo).

### "Anticheat ativo"
- **O que era:** selo "Anticheat ativo" na mesma seção `.hero-stats`.
- **Por que saiu:** não há detecção anti-trapaça implementada — era uma promessa vazia.
- **Para voltar:** implementar detecção real (ex.: validação server-side já existe via
  motor autoritativo; falta anti-conluio/anti-bot e monitoramento) antes de reanunciar.

### Links do rodapé: Regras, Discord, Contato
- **O que era:** três links no rodapé (`.foot-links`) sem destino (`<a>` sem `href`).
- **Por que saiu:** nenhum deles aponta para algo real (sem página de regras, sem
  servidor Discord, sem canal de contato).
- **Para voltar:** criar a página de Regras, o servidor/convite do Discord e um canal de
  contato (ou página), então religar os links com `href` reais.

---

## Lobby (navegador de salas) — `apps/web/src/site/RoomBrowser.tsx`

### "Jogo rápido" e "Ranqueada" (matchmaking)
- **O que era:** dois blocos de ação que prometiam matchmaking automático (entrar em
  qualquer mesa casual / fila ranqueada).
- **Por que saiu:** não há sistema de matchmaking nem ranking implementado. Ficaram
  **desativados** ("Em breve") em vez de removidos, para sinalizar a intenção.
- **Para voltar:** implementar a **fila de matchmaking** (casual) e o sistema de
  **ranqueada + ELO** (ver item ELO abaixo).

### Busca por nome/host e filtros "Mapa" / "Modo"
- **O que era:** uma toolbar com campo de busca e dois filtros (`.room-toolbar`).
- **Por que saiu:** operavam sobre dados mockados; a listagem real ainda é simples.
- **Para voltar:** reimplementar busca e filtros sobre a **listagem real de salas**
  (`GET /api/rooms`), com query params (nome/host/mapa/modo) no backend.

### Colunas "Modo" e "Ping" da listagem de salas
- **O que era:** colunas Modo (Casual/Ranqueada/Velocidade) e Ping (ms) na tabela de salas.
- **Por que saiu:** ambas eram mockadas — não há modo ranqueado/velocidade nem medição
  real de latência. A listagem agora mostra só dados reais (Sala, Mapa, Jogadores).
- **Para voltar:** Modo depende do sistema de ranqueada/matchmaking; Ping exige medir
  latência real cliente↔servidor (ex.: RTT do WebSocket) e expor por sala.

---

## Perfil — `apps/web/src/site/Profile.tsx`

### ELO (valor + delta)
- **O que era:** card "ELO" com valor numérico (ex.: 1.842) e delta (ex.: +24).
- **Por que saiu:** não há sistema de rating. Substituído por um selo "Em breve".
- **Para voltar:** implementar o sistema de **rating (ELO)** atualizado ao fim de cada
  partida ranqueada (`player_stats.rating` já existe no schema).

### Conquistas
- **O que era:** grade de conquistas (mockadas, "7 de 32 desbloqueadas").
- **Por que saiu:** não há catálogo nem lógica de desbloqueio. Substituído por "Em breve".
- **Para voltar:** definir o **catálogo de conquistas** + regras de desbloqueio,
  gravando em `achievement` (tabela já existe) e exibindo no perfil.

---

## Multiplayer / salas (refinos futuros)

### Co-jogo ao vivo, reconexão e bot-takeover — FEITO
- **Rotas em inglês:** `/room/<code>` (sala em qualquer estado: espera/em partida/
  finalizada — única URL do início ao fim) e `/profile/<username>` (compartilhável,
  somente leitura para terceiros). `apps/web/src/site/RoomScreen.tsx` unifica "Monte
  sua mesa" e a antiga "Sala de Espera" num único componente (sem navegação separada;
  o link aparece na hora, no card do topo).
- **Co-jogo ao vivo:** ao "Começar partida" (`POST /api/rooms/:code/start`), o servidor
  monta o `RoomConfig` final (host + bots + humanos já sentados) e liga o `GameRoom`
  autoritativo num `RoomManager` compartilhado entre HTTP e WS (`packages/server/src/
  room.ts` + `server.ts`). `Game.tsx` ganhou um modo `online` (prop opcional): quando
  presente, `dispatch` envia a ação pelo `GameClient` e o estado vem do servidor (fog
  of war/espectador via `projectFor`/`projectForSpectator`) em vez de rodar `reduce`
  localmente; loop de bots e timeout do cliente ficam desligados (o servidor manda).
- **Reconexão por conta:** assentos são identificados por `userId` (login já é
  obrigatório), não por um id de conexão efêmero — reabrir o link em outro
  navegador/dispositivo reocupa o mesmo assento automaticamente.
- **Bot-takeover com graça:** ao cair a conexão, `LiveRoom.disconnect()` agenda a
  conversão em bot médio após `RECONNECT_GRACE_MS` (15s) — reconectar antes cancela.
  Heartbeat ws ping/pong (10s) detecta quedas silenciosas. Indicador "🤖 assumiu" na UI
  para assentos originalmente humanos hoje pilotados por bot (`awayColors`).
- **Espectadores:** quem acessa `/room/<code>` de uma partida em andamento sem ser
  membro entra como espectador (estado com TODAS as mãos ocultas, sem `dispatch`).
- **Limpeza de sala vazia:** `RoomManager.sweep()` (a cada 30s) marca `abandoned`
  salas sem nenhum humano conectado por 5 min (`EMPTY_ROOM_TTL_MS`) — o link passa a
  404. Salas `finished` não são marcadas `abandoned` (o resultado continua acessível).

### Persistência de partidas em andamento — FEITO
- **O que era:** o `GameState` vivo de uma sala ficava só em memória no servidor, então
  um restart/deploy derrubava partidas em andamento (quem tentasse reconectar recebia
  "sala não encontrada" mesmo com o registro no banco).
- **O que é agora:** persistência restart-safe do estado autoritativo
  (`packages/server/src/snapshots.ts`). O `server.ts` grava o `GameState` completo em
  JSON por `room_code` (upsert com debounce; tabela `game_snapshot`) e, ao reconectar
  numa sala `in_progress`, o `loadGameForEnter` reconstrói o `RoomConfig` dos metadados
  duráveis + carrega o snapshot salvo, recriando o `GameRoom` após o restart (sem
  snapshot ainda → recria a partida do config). O snapshot é apagado ao terminar/
  abandonar. Tudo protegido por `hasDatabase()` e coberto por
  `packages/server/test/persistence.test.ts`. Um deploy causa só uma breve interrupção.

### Gravação de partidas/estatísticas — FEITO (Tier 1, item 1)
- **O que era:** `match`/`match_player`/`player_stats` sem escrita — o perfil mostrava
  stats zeradas mesmo após partidas online reais.
- **O que é agora:** ao detectar `state.phase === 'ended'`, o servidor grava o
  resultado (`packages/server/src/match.ts`): `match` (seed + config resumida +
  vencedor), `match_player` (só humanos: cor, pontos via `scoreOf`, venceu) e atualiza
  `player_stats` (jogos, vitórias, sequência atual/recorde). O núcleo é puro/testável
  (`summarizeMatch`, `applyStatsDelta`); a persistência é best-effort (uma falha não
  derruba a partida em memória). O perfil (`GET /api/profile/stats`) já reflete tudo.

### Amigos + Karma — FEITO (Tier 1, itens 2 e 3)
- **Amigos:** `packages/server/src/friends.ts` + página `apps/web/src/site/Friends.tsx`.
  Adicionar por username, aceitar/recusar/cancelar pedidos (pedido recíproco é
  auto-aceito), lista com status online e atalho para entrar/assistir a sala do amigo
  (usa a presença). Botão "Adicionar amigo" também no perfil público.
- **Karma (anti-abandono):** contadores `games_completed`/`games_abandoned` em
  `player_stats` (migration `0003_social_stats`). Ao encerrar a partida, quem terminou
  como bot (vaga convertida = `awayColors`) conta como abandono; senão, concluída. A %
  de karma (`packages/server/src/karma.ts`, 100% até ter amostra mínima) aparece no
  perfil. **Follow-up:** filtro de karma na sala (bloquear entrada abaixo de um mínimo)
  — a base pura (`meetsKarma`) já existe; falta o controle no editor da sala + o gate
  no join.
