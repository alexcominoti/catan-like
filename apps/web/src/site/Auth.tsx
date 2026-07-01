import { useState, type FormEvent } from 'react';
import { Hexagon } from 'lucide-react';
import { authClient, resetRedirectUrl } from '../auth/client.js';
import { validateUsername } from '../auth/username.js';
import './auth.css';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

/** Le ?token= da URL (link de redefinicao de senha enviado por e-mail). */
function resetTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('token');
}

export function Auth({ onAuthed }: { onAuthed: () => void }) {
  const token = resetTokenFromUrl();
  const [mode, setMode] = useState<Mode>(token ? 'reset' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await authClient.signIn.email({ email, password });
        if (error) throw new Error(error.message ?? 'Falha no login.');
        onAuthed();
      } else if (mode === 'signup') {
        // O "nome" no cadastro É o username: valida a regex antes de enviar.
        const vErr = validateUsername(name);
        if (vErr) throw new Error(vErr);
        const { error } = await authClient.signUp.email({ email, password, name: name.trim() });
        if (error) throw new Error(error.message ?? 'Falha no cadastro.');
        setNotice('Conta criada! Verifique seu e-mail para confirmar (se exigido) e entre.');
        setMode('login');
      } else if (mode === 'forgot') {
        const { error } = await authClient.requestPasswordReset({ email, redirectTo: resetRedirectUrl() });
        if (error) throw new Error(error.message ?? 'Falha ao enviar e-mail.');
        setNotice('Se o e-mail existir, enviamos um link para redefinir a senha.');
      } else if (mode === 'reset') {
        if (!token) throw new Error('Token de redefinicao ausente ou invalido.');
        const { error } = await authClient.resetPassword({ newPassword: password, token });
        if (error) throw new Error(error.message ?? 'Falha ao redefinir a senha.');
        setNotice('Senha redefinida! Voce ja pode entrar.');
        setMode('login');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = {
    login: 'Entrar',
    signup: 'Criar conta',
    forgot: 'Recuperar senha',
    reset: 'Definir nova senha',
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="brand-mark"><Hexagon size={18} strokeWidth={2.5} /></span> Trevalis
        </div>
        <h1>{titles[mode]}</h1>

        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="auth-notice">{notice}</div>}

        {mode === 'signup' && (
          <label>
            Nome de usuário
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="username"
              placeholder="ex.: marina.dev"
              minLength={4}
              maxLength={20}
            />
            <small className="auth-hint">4–20 caracteres; letras, números, ponto e hífen.</small>
          </label>
        )}

        {(mode === 'login' || mode === 'signup' || mode === 'forgot') && (
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
        )}

        {(mode === 'login' || mode === 'signup' || mode === 'reset') && (
          <label>
            {mode === 'reset' ? 'Nova senha' : 'Senha'}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
        )}

        <button className="cta auth-submit" type="submit" disabled={busy}>
          {busy ? '...' : titles[mode]}
        </button>

        <div className="auth-links">
          {mode === 'login' && (
            <>
              <button type="button" className="link" onClick={() => setMode('signup')}>Criar conta</button>
              <button type="button" className="link" onClick={() => setMode('forgot')}>Esqueci a senha</button>
            </>
          )}
          {mode === 'signup' && (
            <button type="button" className="link" onClick={() => setMode('login')}>Ja tenho conta</button>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <button type="button" className="link" onClick={() => setMode('login')}>Voltar ao login</button>
          )}
        </div>
      </form>
    </div>
  );
}
