#!/usr/bin/env node
/**
 * Falha se alguma dependência DE RUNTIME tiver alerta de segurança.
 *
 * Por que não `npm audit --omit=dev`: em monorepo com workspaces o npm não
 * propaga o `--omit` para as devDependencies dos pacotes filhos — medido neste
 * repositório, `npm audit --omit=dev` devolve os mesmos 9 alertas do audit
 * completo, e `npm ls --omit=dev` chega a listar o vitest como se fosse de
 * produção. Um portão que acusa sempre é pior que portão nenhum: alguém desliga
 * na primeira vez que ele barra um PR legítimo.
 *
 * Então a árvore de produção é montada aqui: parte das `dependencies` (nunca
 * `devDependencies`) de cada workspace e caminha o transitivo pelo que está
 * instalado. É a mesma fronteira que o `npm ci --omit=dev` do Dockerfile aplica
 * na imagem final.
 *
 * Uso: node scripts/audit-runtime.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfies } from 'semver';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

function lerJson(caminho) {
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
}

/** Onde o Node acharia `nome` a partir de `desde` (workspace primeiro, raiz depois). */
function resolverPacote(nome, desde) {
  for (let dir = desde; ; dir = dirname(dir)) {
    const p = join(dir, 'node_modules', nome, 'package.json');
    if (existsSync(p)) return p;
    if (dir === RAIZ) break;
  }
  return null;
}

/** Nomes dos workspaces (para não confundir link local com pacote publicado). */
function workspaces() {
  const raiz = lerJson(join(RAIZ, 'package.json'));
  const dirs = [];
  for (const padrao of raiz?.workspaces ?? []) {
    const base = padrao.replace(/\/\*$/, '');
    const baseDir = join(RAIZ, base);
    if (!existsSync(baseDir)) continue;
    for (const nome of readdirSync(baseDir)) {
      if (nome && existsSync(join(baseDir, nome, 'package.json'))) dirs.push(join(baseDir, nome));
    }
  }
  return dirs;
}

/**
 * Fecho transitivo das dependências de produção, como `nome -> versões`.
 *
 * A versão importa: com workspaces o npm iça uma cópia para a raiz e deixa
 * outras aninhadas. Aqui há quatro `esbuild` instalados ao mesmo tempo, e só o
 * 0.28.1 (dentro do `tsx`) é o que produção carrega — comparar só por NOME
 * acusaria o 0.21.5 içado, que pertence ao vite e nunca sai do ambiente de
 * desenvolvimento.
 */
function arvoreDeProducao() {
  const versoes = new Map();
  const vistos = new Set();
  const fila = [];

  for (const dir of workspaces()) {
    const pkg = lerJson(join(dir, 'package.json'));
    // Só `dependencies` — devDependencies ficam de fora da imagem.
    for (const nome of Object.keys(pkg?.dependencies ?? {})) fila.push([nome, dir]);
  }

  while (fila.length) {
    const [nome, desde] = fila.pop();
    const caminho = resolverPacote(nome, desde);
    if (!caminho) continue; // link de workspace ou opcional ausente
    // A chave é o CAMINHO: o mesmo nome em pastas diferentes é outra cópia,
    // com outra versão, e cada uma precisa ser visitada.
    if (vistos.has(caminho)) continue;
    vistos.add(caminho);
    const pkg = lerJson(caminho);
    if (!versoes.has(nome)) versoes.set(nome, new Set());
    if (pkg?.version) versoes.get(nome).add(pkg.version);
    for (const filho of Object.keys(pkg?.dependencies ?? {})) {
      fila.push([filho, dirname(caminho)]);
    }
  }
  return versoes;
}

function auditoria() {
  // Em Windows o executavel e `npm.cmd`, e desde o Node 20 o `execFile` recusa
  // um `.cmd` sem shell (CVE-2024-27980). Sem isto o script so rodava em Linux e
  // quem desenvolve em Windows nao conseguia checar o portao antes de abrir o PR.
  const ehWindows = process.platform === 'win32';
  let saida;
  try {
    saida = execFileSync(ehWindows ? 'npm.cmd' : 'npm', ['audit', '--json'], {
      encoding: 'utf8',
      cwd: RAIZ,
      shell: ehWindows,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    // `npm audit` sai com código != 0 quando encontra algo — a saída é válida.
    saida = err.stdout;
  }
  // Sem saida o npm nem chegou a rodar (fora do PATH, por exemplo). Falhar aqui
  // dizendo o que houve e melhor que estourar num `JSON.parse(undefined)` cru.
  if (!saida) {
    console.error('Nao foi possivel executar `npm audit`. O npm esta no PATH?');
    process.exit(2);
  }
  return JSON.parse(saida)?.vulnerabilities ?? {};
}

const producao = arvoreDeProducao();
const alertas = auditoria();

/**
 * O alerta chega a este pacote por um caminho que existe em produção?
 *
 * `via` traz ou o próprio aviso (objeto: a falha é NESTE pacote) ou o nome de
 * quem o arrasta (string). O npm atribui a falha de uma peer dependency OPCIONAL
 * ao pacote que a declara — é assim que o `better-auth` aparece "vulnerável" por
 * causa do `drizzle-kit`, que ele só usaria se alguém rodasse a geração de
 * schema pela CLI. Sem esse filtro o portão nasce vermelho e é desligado na
 * primeira semana.
 */
function exposicaoReal(v) {
  const proprio = v.via.some((x) => typeof x === 'object');
  if (proprio) return true;
  return v.via.some((nome) => typeof nome === 'string' && nome !== v.name && producao.has(nome));
}

/** Alguma cópia instalada EM PRODUÇÃO cai na faixa vulnerável? */
function versaoAtingida(nome, faixa) {
  const instaladas = [...(producao.get(nome) ?? [])];
  if (instaladas.length === 0) return false;
  // Sem faixa utilizável, assume atingido — melhor um falso positivo que um furo.
  if (!faixa) return true;
  try {
    return instaladas.some((ver) => satisfies(ver, faixa, { includePrerelease: true }));
  } catch {
    return true;
  }
}

const naProducao = Object.entries(alertas).filter(
  ([nome, v]) => producao.has(nome) && versaoAtingida(nome, v.range),
);
const atingidos = naProducao.filter(([, v]) => exposicaoReal(v));
const soPorPeerOpcional = naProducao.filter(([, v]) => !exposicaoReal(v));

console.log(`Árvore de produção: ${producao.size} pacotes.`);
console.log(`Alertas no total: ${Object.keys(alertas).length}.`);

for (const [nome, v] of soPorPeerOpcional) {
  console.log(
    `\nIgnorado: ${nome} — atribuído por peer opcional ` +
      `(${v.via.filter((x) => typeof x === 'string').join(', ')}), fora da imagem.`,
  );
}

if (atingidos.length === 0) {
  console.log('\nNenhum alerta atinge dependência de runtime. OK.');
  const fora = Object.keys(alertas).length - atingidos.length;
  if (fora) {
    console.log(`(${fora} alerta(s) em ferramenta de build/teste — fora da imagem.)`);
  }
  process.exit(0);
}

console.error('\nAlerta em dependência de RUNTIME (vai para a imagem):\n');
for (const [nome, v] of atingidos) {
  console.error(`  ${nome} (${v.severity}) — versões ${v.range}`);
  for (const via of v.via) {
    if (typeof via === 'object') console.error(`      ${via.title}\n      ${via.url}`);
    else if (via !== nome) console.error(`      via ${via}`);
  }
}
console.error('\nCorrija antes de subir. Se for transitivo por ferramenta de build,');
console.error('confirme que o pacote realmente não é carregado em runtime.');
process.exit(1);
