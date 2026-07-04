import { Hexagon } from 'lucide-react';
import { authClient } from '../auth/client.js';

export type Page = 'landing' | 'lobby' | 'room' | 'profile' | 'friends' | 'auth';

export function SiteHeader({ page, onNav }: { page: Page; onNav: (p: Page, param?: string) => void }) {
  const { data: session } = authClient.useSession();
  const user = session?.user as (NonNullable<typeof session>['user'] & { username?: string | null }) | undefined;
  const ownUsername = user?.username ?? user?.name;

  return (
    <header className="site-header">
      <button className="brand" onClick={() => onNav('landing')}>
        <span className="brand-mark"><Hexagon size={18} strokeWidth={2.5} /></span> Trevalis
      </button>
      <nav className="site-nav">
        <button className={page === 'lobby' ? 'on' : ''} onClick={() => onNav('lobby')}>Lobby</button>
        {user && (
          <button className={page === 'friends' ? 'on' : ''} onClick={() => onNav('friends')}>Amigos</button>
        )}
        <button className={page === 'profile' ? 'on' : ''} onClick={() => onNav('profile', ownUsername)}>Perfil</button>
      </nav>
      <div className="site-actions">
        {user ? (
          <>
            <button className="ghost" onClick={() => onNav('profile', ownUsername)}>{user.name ?? user.email}</button>
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
