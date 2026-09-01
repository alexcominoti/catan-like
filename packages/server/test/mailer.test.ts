/**
 * O stub do mailer não pode existir em produção.
 *
 * Sem `RESEND_API_KEY` o mailer caía num stub que escreve o CORPO do e-mail no
 * console — e esse corpo carrega o link de redefinição de senha e o de
 * confirmação de conta. Em produção isso transforma qualquer acesso ao log
 * (painel do Fly, um coletor externo, um print colado num chamado) em tomada de
 * conta, sem precisar da senha de ninguém.
 *
 * Em dev o stub é justamente o que faz o fluxo funcionar sem provedor de e-mail,
 * então ele fica — a diferença é só o `NODE_ENV`.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const ORIGINAL = { ...process.env };

/** Importa o mailer do zero (ele lê RESEND_API_KEY no carregamento do módulo). */
async function carregarMailer() {
  vi.resetModules();
  return import('../src/mailer.js');
}

const carta = {
  to: 'jogador@exemplo.com',
  subject: 'Redefinir senha',
  html: '<a href="https://trevalis.app/reset?token=SEGREDO">trocar</a>',
  text: 'Trocar senha: https://trevalis.app/reset?token=SEGREDO',
};

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe('mailer sem RESEND_API_KEY', () => {
  it('em PRODUÇÃO falha em vez de logar o link', async () => {
    process.env.NODE_ENV = 'production';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sendEmail } = await carregarMailer();

    await expect(sendEmail(carta)).rejects.toThrow();

    // O ponto todo: o token não pode aparecer em NENHUMA saída.
    const tudo = [...log.mock.calls, ...erro.mock.calls].flat().join(' ');
    expect(tudo).not.toContain('SEGREDO');
    expect(tudo).not.toContain(carta.text);
    // Mas o operador precisa saber que o envio foi abortado.
    expect(erro.mock.calls.flat().join(' ')).toContain('RESEND_API_KEY');
  });

  it('fora de produção mantém o stub (é o que faz o dev funcionar)', async () => {
    process.env.NODE_ENV = 'development';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { sendEmail } = await carregarMailer();

    await expect(sendEmail(carta)).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(' ')).toContain('SEGREDO');
  });
});
