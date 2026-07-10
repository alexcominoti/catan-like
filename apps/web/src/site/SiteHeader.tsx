import { Hexagon } from 'lucide-react';
import { authClient } from '../auth/client.js';
import { NotificationsBell } from './NotificationsBell.js';
import { useLang, useT, LANGS } from '../i18n/index.js';

export type Page = 'landing' | 'lobby' | 'room' | 'profile' | 'friends' | 'auth';

/** Seletor de idioma PT | EN (compacto, no cabeçalho). */
function LangSwitcher() {
  const { lang, setLang } = useLang();
  const t = useT();
  return (
    <div className="lang-switch" role="group" aria-label={t('header.lang.label')}>
      {LANGS.map((l) => (
        <button
          key={l}
          className={l === lang ? 'on' : ''}
          aria-pressed={l === lang}
          onClick={() => setLang(l)}
        >
          {l === 'pt-BR' ? 'PT' : 'EN'}
        </button>
      ))}
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
