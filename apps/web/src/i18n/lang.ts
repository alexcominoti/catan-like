/**
 * Idioma da interface: pt-BR / en. Zero-dependência.
 *
 * Detecção na 1ª visita: se o navegador indicar um locale LUSÓFONO (idioma `pt` ou
 * região de país que fala português), assume pt-BR; qualquer outro → en. A escolha do
 * usuário fica em localStorage e tem prioridade sobre a detecção. Default: pt-BR.
 */
export type Lang = 'pt-BR' | 'en';

export const LANGS: Lang[] = ['pt-BR', 'en'];

const STORAGE_KEY = 'trevalis.lang';

/** Regiões (ISO 3166-1 alpha-2) de países cuja língua oficial é o português. */
const LUSOPHONE_REGIONS = new Set([
  'BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL', 'GQ', 'MO',
]);

/** Um locale BCP-47 é lusófono? (idioma `pt` OU região de país lusófono). */
function isLusophone(tag: string): boolean {
  const parts = tag.toLowerCase().split('-');
  if (parts[0] === 'pt') return true;
  const region = parts.find((p) => p.length === 2 && /^[a-z]{2}$/.test(p));
  return region ? LUSOPHONE_REGIONS.has(region.toUpperCase()) : false;
}

/** O valor guardado é um idioma válido? */
function isLang(v: unknown): v is Lang {
  return v === 'pt-BR' || v === 'en';
}

/** Idioma salvo pelo usuário, ou null se ainda não escolheu. */
export function storedLang(): Lang | null {
  if (typeof localStorage === 'undefined') return null;
  const v = localStorage.getItem(STORAGE_KEY);
  return isLang(v) ? v : null;
}

/** Persiste a escolha do usuário. */
export function storeLang(lang: Lang): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, lang);
}

/**
 * Idioma inicial: escolha salva > detecção pela região do navegador > pt-BR.
 */
export function detectLang(): Lang {
  const saved = storedLang();
  if (saved) return saved;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const tags = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  for (const tag of tags) {
    if (isLusophone(tag)) return 'pt-BR';
    // primeiro locale não-lusófono explícito → en
    return 'en';
  }
  return 'pt-BR';
}
