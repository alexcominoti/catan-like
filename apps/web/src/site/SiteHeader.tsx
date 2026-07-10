import { useEffect, useRef, useState } from 'react';
import { Hexagon, Globe, ChevronDown, Check } from 'lucide-react';
import { authClient } from '../auth/client.js';
import { NotificationsBell } from './NotificationsBell.js';
import { useLang, useT, LANGS, type Lang } from '../i18n/index.js';

export type Page = 'landing' | 'lobby' | 'room' | 'profile' | 'friends' | 'auth';

/** Nome de cada idioma no PRÓPRIO idioma (endônimo) — para o usuário se achar. */
const LANG_NAME: Record<Lang, string> = { 'pt-BR': 'Português', en: 'English' };

/**
 * Bandeira do Brasil em SVG. Emoji de bandeira (🇧🇷) NÃO renderiza como bandeira
 * no Windows/Chrome (vira "BR"), então desenhamos.
 */
function BrFlag({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.7)} viewBox="0 0 28 20" aria-hidden="true" style={{ display: 'block', borderRadius: 3, flexShrink: 0 }}>
      <rect width="28" height="20" rx="3" fill="#1f9d43" />
      <path d="M14 2.4 L25.6 10 L14 17.6 L2.4 10 Z" fill="#f7d117" />
      <circle cx="14" cy="10" r="4.1" fill="#16357e" />
    </svg>
  );
}

/** Ícone de cada idioma: bandeira do BR (pt-BR) ou globo (en). */
function LangIcon({ lang }: { lang: Lang }) {
  return lang === 'pt-BR' ? <BrFlag /> : <Globe size={16} />;
}

/** Seletor de idioma (dropdown) com bandeira do Brasil (pt-BR) e globo (en). */
function LangSwitcher() {
  const { lang, setLang } = useLang();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="lang-select" ref={ref}>
      <button
        className="lang-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('header.lang.select')}
        title={t('header.lang.select')}
        onClick={() => setOpen((o) => !o)}
      >
        <LangIcon lang={lang} />
        <span className="lang-code">{lang === 'pt-BR' ? 'PT-BR' : 'EN'}</span>
        <ChevronDown size={14} className={`lang-caret${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="lang-menu" role="listbox" aria-label={t('header.lang.select')}>
          {LANGS.map((l) => (
            <button
              key={l}
              role="option"
              aria-selected={l === lang}
              className={`lang-option${l === lang ? ' on' : ''}`}
              onClick={() => { setLang(l); setOpen(false); }}
            >
              <LangIcon lang={l} />
              <span className="lang-name">{LANG_NAME[l]}</span>
              {l === lang && <Check size={15} className="lang-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SiteHeader({ page, onNav }: { page: Page; onNav: (p: Page, param?: string) => void }) {
  const { data: session } = authClient.useSession();
  const t = useT();
  const user = session?.user as (NonNullable<typeof session>['user'] & { username?: string | null }) | undefined;
  const ownUsername = user?.username ?? user?.name;

  return (
    <header className="site-header">
      <button className="brand" onClick={() => onNav('landing')}>
        <span className="brand-mark"><Hexagon size={18} strokeWidth={2.5} /></span> Trevalis
      </button>
      <nav className="site-nav">
        <button className={page === 'lobby' ? 'on' : ''} onClick={() => onNav('lobby')}>{t('header.lobby')}</button>
        {user && (
          <button className={page === 'friends' ? 'on' : ''} onClick={() => onNav('friends')}>{t('header.friends')}</button>
        )}
        <button className={page === 'profile' ? 'on' : ''} onClick={() => onNav('profile', ownUsername)}>{t('header.profile')}</button>
      </nav>
      <div className="site-actions">
        <LangSwitcher />
        {user ? (
          <>
            <NotificationsBell onEnterRoom={(code) => onNav('room', code)} />
            <button className="ghost" onClick={() => onNav('profile', ownUsername)}>{user.name ?? user.email}</button>
            <button className="cta" onClick={() => void authClient.signOut()}>{t('header.signOut')}</button>
          </>
        ) : (
          <>
            <button className="ghost" onClick={() => onNav('auth')}>{t('header.signIn')}</button>
            <button className="cta" onClick={() => onNav('lobby')}>{t('header.playNow')}</button>
          </>
        )}
      </div>
    </header>
  );
}
