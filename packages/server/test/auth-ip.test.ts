/**
 * O rate limit do Better Auth enxerga o IP do cliente?
 *
 * `/api/auth/*` NAO passa pelo nosso limitador (rate-limit.ts) — quem defende
 * login, cadastro e reset e o limitador interno do Better Auth, e ele so separa
 * os baldes se conseguir resolver o IP. O padrao da lib e `x-forwarded-for`, que
 * atras do Fly nunca resolve: o proxy acrescenta o IP real ao que o cliente
 * mandou, e a lib recusa cabecalho com mais de um valor porque o primeiro salto
 * e forjavel. Sem IP ela cai num balde UNICO por rota — foi o que rodou em
 * producao ate aqui: dez tentativas de login por minuto no total, de todo mundo
 * somado, e o jogador seguinte tomava 429 sem ter feito nada.
 *
 * Por isso os testes batem no `getIp` da propria lib com a NOSSA configuracao:
 * um upgrade que mude a leitura de cabecalho quebra aqui, e nao na cara dos
 * jogadores. O caminho ponta a ponta (11a tentativa vira 429, e outro IP passa)
 * foi conferido a mao contra o servidor rodando.
 */
import { describe, it, expect } from 'vitest';
import { getIp } from 'better-auth/api';
import { IP_HEADER } from '../src/rate-limit.js';

/** A configuracao que auth.ts entrega ao Better Auth. */
const opcoes = { advanced: { ipAddress: { ipAddressHeaders: [IP_HEADER] } } } as never;

/** Requisicao como o proxy do Fly entrega: `fly-client-ip` + `x-forwarded-for`. */
function requisicao(headers: Record<string, string>): Request {
  return new Request('https://trevalis.app/api/auth/sign-in/email', {
    method: 'POST',
    headers,
  });
}

describe('IP do cliente para o rate limit do Better Auth', () => {
  it('resolve o IP a partir do cabecalho do Fly', () => {
    const req = requisicao({ [IP_HEADER]: '203.0.113.10' });
    expect(getIp(req, opcoes)).toBe('203.0.113.10');
  });

  it('da baldes diferentes para clientes diferentes', () => {
    const a = getIp(requisicao({ [IP_HEADER]: '203.0.113.10' }), opcoes);
    const b = getIp(requisicao({ [IP_HEADER]: '198.51.100.20' }), opcoes);
    expect(a).not.toBe(b);
    expect(b).toBe('198.51.100.20');
  });

  it('ignora o `x-forwarded-for` que o cliente forjou', () => {
    // O atacante manda um XFF qualquer para trocar de balde a cada tentativa; o
    // proxy do Fly ainda escreve o `fly-client-ip` verdadeiro, e e ele que vale.
    const req = requisicao({
      [IP_HEADER]: '203.0.113.10',
      'x-forwarded-for': '9.9.9.9',
    });
    expect(getIp(req, opcoes)).toBe('203.0.113.10');
  });

  it('sem a nossa configuracao, dois clientes caem no MESMO balde', () => {
    // O bug que a configuracao conserta. Com o padrao da lib
    // (`x-forwarded-for`), a cadeia que o Fly monta tem dois valores e ela
    // desiste de resolver — os dois clientes viram a mesma chave de rate limit.
    const padrao = { advanced: {} } as never;
    const a = requisicao({
      [IP_HEADER]: '203.0.113.10',
      'x-forwarded-for': '203.0.113.10, 66.241.125.1',
    });
    const b = requisicao({
      [IP_HEADER]: '198.51.100.20',
      'x-forwarded-for': '198.51.100.20, 66.241.125.1',
    });
    expect(getIp(a, padrao)).toBe(getIp(b, padrao));
    expect(getIp(a, opcoes)).not.toBe(getIp(b, opcoes));
  });

  it('sem nenhum cabecalho de IP nao atribui a requisicao a um cliente', () => {
    // Nao da para exigir `null` aqui: com NODE_ENV=test a lib devolve
    // `127.0.0.1` de proposito. O que importa e que ninguem ganha balde
    // proprio sem o cabecalho — as duas requisicoes compartilham a chave.
    const um = getIp(requisicao({}), opcoes);
    const outro = getIp(requisicao({}), opcoes);
    expect(um).toBe(outro);
    expect(um).not.toBe('203.0.113.10');
  });
});
