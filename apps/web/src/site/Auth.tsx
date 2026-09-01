import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Hexagon } from 'lucide-react';
import { authClient, resetRedirectUrl } from '../auth/client.js';
import { captchaHeaders, renderTurnstile } from '../auth/turnstile.js';
import { validateUsername } from '../auth/username.js';
import { useT, useLang, type MsgKey } from '../i18n/index.js';
import './auth.css';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

const TITLE_KEY: Record<Mode, MsgKey> = {
  login: 'auth.title.login',
  signup: 'auth.title.signup',
  forgot: 'auth.title.forgot',
  reset: 'auth.title.reset',
};

/** Le ?token= da URL (link de redefinicao de senha enviado por e-mail). */
function resetTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('token');
}

export function Auth({ onAuthed }: { onAuthed: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const token = resetTokenFromUrl();
  const [mode, setMode] = useState<Mode>(token ? 'reset' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Turnstile: o widget só aparece se o servidor tiver as chaves configuradas
  // (GET /api/config). Sem elas, `captchaRef` fica vazio e o cabeçalho não vai —
  // exatamente o fluxo antigo.
  const captchaBox = useRef<HTMLDivElement | null>(null);
  const captchaWidget = useRef<{ reset: () => void } | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  useEffect(() => {
    const el = captchaBox.current;
    if (!el || captchaWidget.current) return;
    let vivo = true;
    void renderTurnstile(el, (tk) => vivo && setCaptchaToken(tk)).then((w) => {
      if (vivo) captchaWidget.current = w;
    });
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * Descarta o token e pede um novo desafio.
   *
   * O token do Turnstile é de USO ÚNICO: a Cloudflare aceita a primeira
   * validação e responde `timeout-or-duplicate` (ou seja, `success: false`) em
   * qualquer reenvio do mesmo token. Por isso ele precisa ser trocado depois de
   * TODA tentativa que o consumiu — inclusive as bem-sucedidas.
   */
  function resetCaptcha() {
    try {
      captchaWidget.current?.reset();
    } catch {
      // Widget já removido do DOM (ex.: o login concluído desmontou a tela).
    }
    setCaptchaToken(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    // O plugin de captcha do Better Auth lê este cabeçalho no cadastro, login e
    // pedido de redefinição. Sem captcha configurado, vai vazio.
    const fetchOptions = { headers: captchaHeaders(captchaToken) };
    try {
      if (mode === 'login') {
        const { error } = await authClient.signIn.email({ email, password, fetchOptions });
        if (error) throw new Error(error.message ?? t('auth.err.login'));
        onAuthed();
      } else if (mode === 'signup') {
        // O "nome" no cadastro É o username: valida a regex antes de enviar.
        const vErr = validateUsername(name);
        if (vErr) throw new Error(vErr);
        const { error } = await authClient.signUp.email({
          email,
          password,
          name: name.trim(),
          language: lang,
          fetchOptions,
        });
        if (error) throw new Error(error.message ?? t('auth.err.signup'));
        setNotice(t('auth.notice.signup'));
        setMode('login');
      } else if (mode === 'forgot') {
        const { error } = await authClient.requestPasswordReset({
          email,
          redirectTo: resetRedirectUrl(),
          fetchOptions,
        });
        if (error) throw new Error(error.message ?? t('auth.err.forgot'));
        setNotice(t('auth.notice.forgot'));
      } else if (mode === 'reset') {
        if (!token) throw new Error(t('auth.err.tokenMissing'));
        const { error } = await authClient.resetPassword({ newPassword: password, token });
        if (error) throw new Error(error.message ?? t('auth.err.reset'));
        setNotice(t('auth.notice.reset'));
        setMode('login');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.err.unexpected'));
    } finally {
      setBusy(false);
      // Vale para o sucesso também, não só para a falha: depois do cadastro
      // caímos na tela de login, e reaproveitar o token já gasto faria a
      // Cloudflare recusá-lo — o primeiro login falharia com um erro de captcha
      // sem qualquer relação com o que o jogador digitou.
      resetCaptcha();
    }
  }

  const title = t(TITLE_KEY[mode]);

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="brand-mark"><Hexagon size={18} strokeWidth={2.5} /></span> Trevalis
        </div>
        <h1>{title}</h1>

        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="auth-notice">{notice}</div>}

        {mode === 'signup' && (
          <label>
            {t('auth.field.username')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="username"
              placeholder={t('auth.field.usernamePlaceholder')}
              minLength={4}
              maxLength={20}
            />
            <small className="auth-hint">{t('auth.field.usernameHint')}</small>
          </label>
        )}

        {(mode === 'login' || mode === 'signup' || mode === 'forgot') && (
          <label>
            {t('auth.field.email')}
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
            {mode === 'reset' ? t('auth.field.newPassword') : t('auth.field.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              // Espelha o servidor: 10 vale para senha NOVA (cadastro/reset).
              // No login não há mínimo — quem criou a conta quando o piso era 8
              // continua entrando; o navegador não pode barrar antes do envio.
              minLength={mode === 'login' ? undefined : 10}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
        )}

        {/* Turnstile: fica vazio (e sem ocupar espaço) se não houver chave. */}
        <div className="auth-captcha" ref={captchaBox} />

        <button className="cta auth-submit" type="submit" disabled={busy}>
          {busy ? '...' : title}
        </button>

        <div className="auth-links">
          {mode === 'login' && (
            <>
              <button type="button" className="link" onClick={() => setMode('signup')}>{t('auth.link.signup')}</button>
              <button type="button" className="link" onClick={() => setMode('forgot')}>{t('auth.link.forgot')}</button>
            </>
          )}
          {mode === 'signup' && (
            <button type="button" className="link" onClick={() => setMode('login')}>{t('auth.link.haveAccount')}</button>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <button type="button" className="link" onClick={() => setMode('login')}>{t('auth.link.backToLogin')}</button>
          )}
        </div>
      </form>
    </div>
  );
}
