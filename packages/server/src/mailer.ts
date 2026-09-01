/**
 * Envio de e-mail transacional (confirmacao de conta, redefinicao de senha).
 *
 * Provedor: Resend (env `RESEND_API_KEY`). Degrada com elegancia: sem chave,
 * apenas LOGA o link no console — util em dev e para nao travar o boot.
 */
import { Resend } from 'resend';
import { tr, type Lang } from './i18n.js';

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? 'Trevalis <no-reply@trevalis.app>';
const resend = apiKey ? new Resend(apiKey) : null;

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(mail: Mail): Promise<void> {
  if (!resend) {
    // Em PRODUCAO o stub nao pode existir: o corpo do e-mail carrega o link de
    // redefinicao de senha e o de confirmacao de conta, e escrever isso no log
    // transforma qualquer acesso aos logs (painel do Fly, um coletor externo,
    // um print em suporte) em tomada de conta. Falha FECHADA e barulhenta —
    // melhor o cadastro acusar erro do que vazar o link em silencio.
    if (process.env.NODE_ENV === 'production') {
      // eslint-disable-next-line no-console
      console.error(
        `[trevalis][email] RESEND_API_KEY ausente em producao — envio para ${mail.to} ABORTADO ` +
          '(o link NAO foi logado). Configure o secret no Fly.',
      );
      throw new Error('Servico de e-mail indisponivel.');
    }
    // eslint-disable-next-line no-console
    console.log(
      `[trevalis][email:stub] para=${mail.to} assunto="${mail.subject}"\n${mail.text}`,
    );
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (error) {
      // NAO relanca: uma falha de e-mail (ex.: dominio ainda nao verificado no
      // Resend) nunca deve quebrar cadastro/recuperacao. Apenas registra.
      // eslint-disable-next-line no-console
      console.error('[trevalis][email] falha ao enviar:', error);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[trevalis][email] erro de transporte:', err);
  }
}

/** Template minimo (mesmo HTML/text) para um e-mail com um botao/link, localizado. */
export function actionEmail(lang: Lang, title: string, intro: string, cta: string, url: string): {
  html: string;
  text: string;
} {
  const footer = tr(lang, 'email.footer', { url });
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
  <h2 style="color:#c2603f">Trevalis</h2>
  <h3>${title}</h3>
  <p>${intro}</p>
  <p><a href="${url}" style="background:#c2603f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${cta}</a></p>
  <p style="color:#888;font-size:12px">${footer}</p>
</div>`;
  const text = `Trevalis — ${title}\n\n${intro}\n\n${cta}: ${url}\n`;
  return { html, text };
}
