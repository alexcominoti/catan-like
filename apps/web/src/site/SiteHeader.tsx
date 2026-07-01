import { Hexagon } from 'lucide-react';
import { authClient } from '../auth/client.js';

export type Page = 'landing' | 'lobby' | 'setup' | 'game' | 'profile' | 'auth' | 'room';

export function SiteHeader({ page, onNav }: { page: Page; onNav: (p: Page) => void }) {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  return (
    <header className="site-header">
      <button className="brand" onClick={() => onNav('landing')}>
        <span className="brand-mark"><Hexagon size={18} strokeWidth={2.5} /></span> Trevalis
      </button>
      <nav className="site-nav">
        <button className={page === 'lobby' ? 'on' : ''} onClick={() => onNav('lobby')}>Lobby</button>
        <button className={page === 'setup' ? 'on' : ''} onClick={() => onNav('setup')}>Jogar</button>
        <button className={page === 'profile' ? 'on' : ''} onClick={() => onNav('profile')}>Perfil</button>
      </nav>
      <div className="site-actions">
        {user ? (
          <>
            <button className="ghost" onClick={() => onNav('profile')}>{user.name ?? user.email}</button>
            <button className="cta" onClick={() => void authClient.signOut()}>Sair</button>
          </>
        ) : (
          <>
            <button className="ghost" onClick={() => onNav('auth')}>Entrar</button>
            <button className="cta" onClick={() => onNav('lobby')}>Jogar agora</button>
          </>
        )}
      </div>
    </header>
  );
}
