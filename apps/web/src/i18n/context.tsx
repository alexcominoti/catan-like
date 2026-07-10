/**
 * Contexto de i18n (zero-dependência). Fornece `lang`, `setLang` e `t(key, params)`.
 *
 * - Idioma inicial: escolha salva > detecção pela região do navegador > pt-BR (ver lang.ts).
 * - Ao trocar: persiste em localStorage, ajusta `document.documentElement.lang` e espelha
 *   na conta (best-effort, PATCH /api/profile) para os e-mails saírem no idioma certo.
 * - `t` faz fallback para pt-BR e, por fim, para a própria chave — nunca quebra render.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { detectLang, storeLang, type Lang } from './lang.js';
import { ptBR, type MsgKey } from './messages.pt-BR.js';
import { en } from './messages.en.js';

const DICTS: Record<Lang, Record<MsgKey, string>> = { 'pt-BR': ptBR, en };

type Params = Record<string, string | number>;

export interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MsgKey, params?: Params) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

/** Substitui `{nome}` pelos parâmetros; deixa intacto o que não for passado. */
function interpolate(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    storeLang(l);
    // Espelha na conta para os e-mails; ignora falhas e usuário deslogado.
    void fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: l }),
    }).catch(() => {});
  }, []);

  const t = useCallback(
    (key: MsgKey, params?: Params) => interpolate(DICTS[lang][key] ?? ptBR[key] ?? key, params),
    [lang],
  );

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error('useI18n usado fora de <I18nProvider>');
  return v;
}

/** Só a função de tradução (atalho comum). */
export function useT() {
  return useI18n().t;
}

/** Idioma atual + setter (para o seletor de idioma). */
export function useLang() {
  const { lang, setLang } = useI18n();
  return { lang, setLang };
}

/** Plural simples (2 formas). Para os poucos casos que precisam. */
export function plural(n: number, one: string, other: string): string {
  return n === 1 ? one : other;
}
