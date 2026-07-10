/**
 * i18n do SERVIDOR (pt-BR / en) — texto gerado no servidor: e-mails e mensagens.
 *
 * O servidor não carrega a UI; aqui ficam só as strings que ele próprio emite
 * (e-mails transacionais e algumas mensagens de conta). O idioma é resolvido por
 * `resolveLang`: preferência salva na conta (`user.language`) → cabeçalho
 * `X-Trevalis-Lang` / `Accept-Language` → pt-BR (default).
 */
export type Lang = 'pt-BR' | 'en';

/** Regiões (ISO 3166-1) de países lusófonos, para detectar pelo Accept-Language. */
const LUSOPHONE = new Set(['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL', 'GQ', 'MO']);

export function isLang(v: unknown): v is Lang {
  return v === 'pt-BR' || v === 'en';
}

/** Um locale BCP-47 mapeia para qual idioma? (pt* ou região lusófona → pt-BR). */
function langFromTag(tag: string): Lang | null {
  const parts = tag.trim().toLowerCase().split(/[-_]/);
  if (!parts[0]) return null;
  if (parts[0] === 'pt') return 'pt-BR';
  const region = parts.find((p) => /^[a-z]{2}$/.test(p));
  if (region && LUSOPHONE.has(region.toUpperCase())) return 'pt-BR';
  return 'en';
}

/**
 * Resolve o idioma de uma requisição/usuário. Ordem: conta salva > header
 * (X-Trevalis-Lang tem prioridade sobre Accept-Language) > pt-BR.
 */
export function resolveLang(opts: {
  user?: { language?: string | null } | null;
  header?: string | null;
  acceptLanguage?: string | null;
}): Lang {
  if (isLang(opts.user?.language)) return opts.user!.language as Lang;
  if (isLang(opts.header)) return opts.header;
  const accept = opts.acceptLanguage;
  if (accept) {
    for (const part of accept.split(',')) {
      const tag = part.split(';')[0]!;
      const l = langFromTag(tag);
      if (l) return l;
    }
  }
  return 'pt-BR';
}

type Dict = Record<string, string>;

const ptBR: Dict = {
  // E-mails
  'email.reset.subject': 'Redefinir senha — Trevalis',
  'email.reset.title': 'Redefinir sua senha',
  'email.reset.intro': 'Recebemos um pedido para redefinir a senha da sua conta Trevalis.',
  'email.reset.cta': 'Redefinir senha',
  'email.verify.subject': 'Confirme seu e-mail — Trevalis',
  'email.verify.title': 'Confirme seu e-mail',
  'email.verify.intro': 'Bem-vindo ao Trevalis! Confirme seu e-mail para ativar a conta.',
  'email.verify.cta': 'Confirmar e-mail',
  'email.footer': 'Se o botão não funcionar, copie e cole: {url}',
  // Conta
  'account.usernameTaken': 'Esse nome de usuário já está em uso.',
  'account.emailTaken': 'Esse e-mail já está cadastrado.',
};

const en: Dict = {
  // Emails
  'email.reset.subject': 'Reset password — Trevalis',
  'email.reset.title': 'Reset your password',
  'email.reset.intro': 'We received a request to reset your Trevalis account password.',
  'email.reset.cta': 'Reset password',
  'email.verify.subject': 'Confirm your email — Trevalis',
  'email.verify.title': 'Confirm your email',
  'email.verify.intro': 'Welcome to Trevalis! Confirm your email to activate your account.',
  'email.verify.cta': 'Confirm email',
  'email.footer': 'If the button doesn’t work, copy and paste: {url}',
  // Account
  'account.usernameTaken': 'That username is already taken.',
  'account.emailTaken': 'That email is already registered.',
};

const DICTS: Record<Lang, Dict> = { 'pt-BR': ptBR, en };

/** Traduz `key` no idioma `lang`, interpolando `{nome}`. Fallback: pt-BR → chave. */
export function tr(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const s = DICTS[lang][key] ?? ptBR[key] ?? key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}
