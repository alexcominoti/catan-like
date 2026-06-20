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
  apps/
    web/       # React + Vite, tabuleiro em SVG (UI hotseat)
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

### Implementado na Fase 1

Setup em serpente · custos e construção (estrada/vila/cidade) · produção 2d6 com
escassez do banco · regra do 7 (descarte + bloqueador + roubo) · comércio 4:1 com
o banco · Estrada Mais Longa (≥5) · Maior Exército (≥3) · vitória (10 pontos).

### Próximos passos

- Jogar cartas de progresso (Cavaleiro, 2 Estradas, +2 Recursos, Monopólio, +1 PV).
- Comércio entre jogadores (propor/responder).
- Portos (2:1 / 3:1).
- Destaque por hover (peça-fantasma) e atalhos (ESC cancela).
- Fase 2: servidor `ws` autoritativo + `projectFor` (fog of war).

## Licença

Privado / não licenciado por enquanto.
