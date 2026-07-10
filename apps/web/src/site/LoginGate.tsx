import { Lock } from 'lucide-react';
import { useT } from '../i18n/index.js';

/**
 * Barreira de login para rotas protegidas (Lobby / Perfil). Só a Home é pública:
 * a proteção real é no servidor (as APIs de lobby/perfil exigem sessão), e esta
 * tela é o correspondente no cliente — redireciona para o login quando não há
 * sessão em vez de mostrar a página vazia.
 */
export function LoginGate({ title, hint, onNeedAuth }: { title: string; hint?: string; onNeedAuth: () => void }) {
  const t = useT();
  return (
    <div className="page">
      <div className="card wr-gate">
        <Lock size={26} className="ic-primary" />
        <h2>{title}</h2>
        {hint && <p className="muted-note">{hint}</p>}
        <button className="cta" onClick={onNeedAuth}>{t('loginGate.cta')}</button>
      </div>
    </div>
  );
}
