# HexGame (nome de trabalho)

Jogo online de **colonização hexagonal** inspirado nas *mecânicas* de jogos de
tabuleiro de troca e construção. Local-first, 100% vetorial (SVG), com um motor
de regras puro e determinístico no centro.

> **Nome provisório.** `HexGame` / `@hexgame/*` é um nome de trabalho neutro —
> a identidade final (nome, arte, termos) ainda será definida.

> **Originalidade.** Este projeto reimplementa **mecânicas** (não protegidas por
> direitos autorais). Toda a **expressão** — nome, arte, paleta, ícones — é
> original. Os termos usados no código (Madeira, Tijolo, Lã, Trigo, Minério,
> Vila, Cidade, Estrada, Bloqueador) são genéricos e funcionais.

## Filosofia: camadas finas e jogáveis

Construído em fases, cada uma jogável de ponta a ponta antes da próxima:

| Fase | Entrega | Status |
|---|---|---|
| **1** | Motor + UI hotseat (1 máquina, mesma tela) | 🟢 em andamento |
| 2 | Servidor local + WebSocket (várias abas/PCs) | ⚪ futuro |
| 3 | Persistência (SQLite) + reconexão + relógio | ⚪ futuro |
| 4 | Contas / matchmaking / deploy (escala real) | ⚪ futuro |

A única peça feita "para durar" desde o início é o **motor de regras**
(`packages/engine`): puro, sem rede, sem React, sem I/O. O mesmo código roda no
navegador (Fase 1) e rodará no servidor (Fase 2+) sem reescrita.

## Estrutura (monorepo, npm workspaces)

```
catan-like/
  packages/
    engine/    # regras puras e determinísticas (testável isolado)
    bot/       # bot heurístico puro: (estado, cor) -> ação
  apps/
    web/       # React + Vite, tabuleiro em SVG (UI hotseat + bots)
```

## Como rodar

Requisitos: **Node 20+** (testado no Node 24).

```bash
npm install            # instala todos os workspaces
npm run dev            # sobe a UI web (Vite) em http://localhost:5173
npm test               # roda os testes do motor (vitest)
npm run typecheck      # checagem de tipos de todos os pacotes
npm run build          # build de produção da web
```

## O motor (`@hexgame/engine`)

API pequena, pura e determinística:

```ts
import { createInitialState, reduce } from '@hexgame/engine';

const s0 = createInitialState({ seed: 42 });   // mesmo seed => mesma partida
const r = reduce(s0, 'red', { t: 'placeSettlement', vertexId: 'v12' });
if (r.ok) { /* r.state, r.events */ } else { /* r.error */ }
```

- **Determinístico:** mesma seed + mesma sequência de ações ⇒ estado idêntico
  (base de testes e, no futuro, replays). O PRNG (`rng`) nunca vai ao cliente.
- **Grafo do tabuleiro:** 19 hexes (anéis 1+6+12), 54 vértices, 72 arestas, com
  **IDs estáveis** pré-computados uma vez.

### Jogo base completo (Fase 1) ✅

Setup em serpente · custos e construção (estrada/vila/cidade) · produção 2d6 com
escassez do banco · regra do 7 (descarte + bloqueador + roubo) · **cartas de
progresso** (Cavaleiro, 2 Estradas, +2 Recursos, Monopólio, +1 PV) · **comércio
marítimo com portos** (4:1 / 3:1 / 2:1) · **comércio entre jogadores** (propor /
aceitar / fechar) · Estrada Mais Longa (≥5) · Maior Exército (≥3) · vitória (10
pontos). UI com destaque de alvos válidos, peça-fantasma no hover e ESC cancela.

### Bots (`@hexgame/bot`)

Bot heurístico com **3 níveis** (fácil / médio / difícil): setup em bons vértices
(difícil pondera portos e escassez), constrói por prioridade (cidade > vila >
estrada), usa cartas/ladrão/portos, troca com o banco para destravar metas, caça
Estrada Mais Longa / Maior Exército (difícil mira o líder ao mover o ladrão). No
lobby cada assento é **Humano** ou **Bot** (com dificuldade própria); na vez de um
bot a UI joga sozinha. É puro e reutilizável no servidor (Fase 2+). Testes simulam
partidas 4-bots até a vitória nos 3 níveis.

### Lobby (estilo colonist.io)

Painel de jogadores (nome/cor/Humano-Bot/dificuldade), tiles de tabuleiro (números
equilibrados, deserto no centro) e sliders de **pontos para vencer** e **limite de
descarte**. Mãos dos adversários ficam ocultas (só a contagem aparece); cartas de
+1 PV são secretas no placar até a vitória.

### Próximos passos

- **IA do bot — passo 3:** busca **expectimax de profundidade 2** (valor esperado
  sobre os resultados dos dados 2–12, ponderados por probabilidade) com poda
  alfa-beta, reaproveitando a função de valor `evaluate()` como folha. É onde está
  o maior salto de força (o `AlphaBetaPlayer n=2` é o bot forte do catanatron).
- **IA do bot — passo 4:** **auto-ajuste dos pesos** `W` da função de valor por
  self-play (hill-climbing / algoritmo genético), usando o harness determinístico
  em `packages/bot/test/selfplay.test.ts`. _(Passos 1–2 — função de valor +
  seleção de jogada por simulação no nível difícil — já entregues; ver bloco
  `FUTURE FEATURES` em `packages/bot/src/index.ts`.)_
- Visualizador de **replay** (partidas já são gravadas em
  `apps/web/src/ui/replays.ts`; falta a tela de listar/assistir).
- Refino de UX, acessibilidade/mobile, tema claro.
- Fase 2: servidor `ws` autoritativo + `projectFor` (fog of war) para jogar de
  abas/PCs diferentes.

## Licença

Privado / não licenciado por enquanto.
