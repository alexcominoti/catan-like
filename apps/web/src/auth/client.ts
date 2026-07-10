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
import { inferAdditionalFields } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
  // Tipa os campos extras do usuário no cliente (sem depender do tipo do servidor),
  // para podermos enviá-los no cadastro — ex.: `language` nos e-mails localizados.
  plugins: [
    inferAdditionalFields({
      user: {
        username: { type: 'string', required: false },
        language: { type: 'string', required: false },
      },
    }),
  ],
});

/** URL para onde o e-mail de redefinicao deve levar (pagina de reset da SPA). */
export function resetRedirectUrl(): string {
  return `${window.location.origin}/reset-password`;
}
