import { Hexagon } from 'lucide-react';

export type Page = 'landing' | 'lobby' | 'setup' | 'game' | 'profile';

export function SiteHeader({ page, onNav }: { page: Page; onNav: (p: Page) => void }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={() => onNav('landing')}>
        <span className="brand-mark"><Hexagon size={18} strokeWidth={2.5} /></span> Hexkeep
      </button>
      <nav className="site-nav">
        <button className={page === 'lobby' ? 'on' : ''} onClick={() => onNav('lobby')}>Lobby</button>
        <button className={page === 'setup' ? 'on' : ''} onClick={() => onNav('setup')}>Jogar</button>
        <button className={page === 'profile' ? 'on' : ''} onClick={() => onNav('profile')}>Perfil</button>
      </nav>
      <div className="site-actions">
        <button className="ghost" onClick={() => onNav('profile')}>Entrar</button>
        <button className="cta" onClick={() => onNav('lobby')}>Jogar agora</button>
      </div>
    </header>
  );
}
