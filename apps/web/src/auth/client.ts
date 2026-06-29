/**
 * Cliente de autenticacao (Better Auth) para o navegador. Fala com o servidor
 * na MESMA origem (em dev, o Vite faz proxy de /api -> :8080), entao os cookies
 * de sessao funcionam sem CORS.
 *
 * Exportamos APENAS `authClient` (e helpers) — re-exportar os metodos
 * desestruturados quebra a emissao de tipos (TS2742). Use `authClient.signIn`,
 * `authClient.useSession()`, etc.
 */
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
});

/** URL para onde o e-mail de redefinicao deve levar (pagina de reset da SPA). */
export function resetRedirectUrl(): string {
  return `${window.location.origin}/reset-password`;
}
