# Backlog — funcionalidades removidas de produção (temporariamente)

Este arquivo registra conteúdo que estava **mockado** (dados falsos) ou prometia algo
que ainda não existe, e por isso foi **removido da produção** até termos a implementação
real. Para cada item: **o que era**, **por que saiu** e **o que falta para voltar**.

> Convenção: ao remover algo mockado da UI, deixe um comentário no código apontando
> para a entrada correspondente aqui.

---

## Landing (página inicial)

### Contagem de "jogadores online"
- **O que era:** o selo "12,4k jogadores online" na seção de prova social, abaixo dos
  CTAs (`apps/web/src/site/Landing.tsx`, `.hero-stats`).
- **Por que saiu:** número fixo, mockado — não reflete jogadores reais.
- **Para voltar:** criar um **serviço de presença/contagem de jogadores online**
  (heartbeat por conexão WS + agregação) e expor um endpoint (ex.: `GET /api/presence`)
  que a landing consome.

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
  real de latência. A listagem agora mostra só dados reais (Salão, Mapa, Jogadores).
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

### Co-jogo ao vivo a partir da sala de espera
- **O que existe:** a sala de espera (`/sala/<code>`) é a **camada de metadados** —
  link único, "Copiar link", entrada via link com login obrigatório, "Sala cheia",
  toggle de sala privada (salvo em `room.is_private`) e listagem real no lobby
  (`GET /api/rooms`). A presença dos jogadores é atualizada por polling leve (4s).
- **O que falta:** o início da partida ainda roda **local** (no cliente do anfitrião,
  com bots preenchendo as vagas). Vários jogadores na **mesma** partida ao vivo ainda
  não estão ligados.
- **Para voltar/evoluir:** ligar o WebSocket já existente (`@trevalis/server` GameRoom /
  `net/client.ts`) à sala de espera: ao "Começar partida", o servidor instancia a
  `GameRoom` a partir de `room.config`, e cada jogador conectado recebe o estado
  projetado (fog of war) em vez de simular localmente. Trocar o polling por broadcast
  de presença pela conexão WS.

### Persistência de partidas em andamento
- **O que era / é:** o `GameState` vivo de uma sala fica só em memória no servidor.
- **Por que importa:** um restart do servidor derruba partidas em andamento.
- **Para voltar/evoluir:** persistir o estado (ou o log de ações para replay
  determinístico) das salas `in_progress`, permitindo retomar após restart.

### Reconexão à sala online e presença ao vivo
- **O que falta:** reconexão suave à sala de espera/partida após queda, e indicador de
  presença ao vivo (quem está conectado) sem polling.
- **Para voltar/evoluir:** broadcast de presença pela conexão WS e fluxo de reconexão
  por sessão/sala.
