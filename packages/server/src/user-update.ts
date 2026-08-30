/**
 * Regra do que pode ser alterado por `POST /api/auth/update-user` — NUCLEO PURO.
 *
 * O Better Auth expoe essa rota aceitando `name`, `image` e os campos extras
 * declarados com `input: true` (no nosso caso `username` e `language`). Isso
 * criava um caminho paralelo para gravar o `username` direto no banco, pulando:
 *   - a regex de validacao (`validateUsername`);
 *   - a unicidade case-insensitive (o indice do banco e sensivel a maiusculas,
 *     entao dava para registrar a variante de capitalizacao do nome de outro);
 *   - a cota de troca UNICA, que so e checada em `/api/profile/username`.
 *
 * A decisao aqui e simples: nome tem UMA porta (a rota do perfil, que escreve
 * pelo Drizzle e nao passa por este hook). O resto e sanitizado.
 */

export type UserUpdateDecision =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

/** Idiomas que a UI e os e-mails realmente suportam. */
const LANGS = new Set(['pt-BR', 'en']);

/**
 * Filtra o patch de um update de usuario. Devolve `ok: false` quando o patch
 * tenta mudar o nome/username (que so a rota do perfil pode fazer).
 *
 * Updates INTERNOS do Better Auth (ex.: marcar `emailVerified` na confirmacao
 * de e-mail) passam intactos — eles nao carregam `name` nem `username`.
 */
export function sanitizeUserUpdate(patch: Record<string, unknown>): UserUpdateDecision {
  if ('username' in patch || 'name' in patch) {
    return { ok: false, error: 'Troque o nome de usuário pelo seu perfil.' };
  }

  const out: Record<string, unknown> = { ...patch };

  // Idioma so pode ser um dos suportados (vai para os e-mails transacionais).
  if ('language' in out && !LANGS.has(String(out.language))) delete out.language;

  // Avatar: hoje a UI nem renderiza, mas nao guardamos string arbitraria —
  // so https e curta (ou null, que e limpar o avatar).
  if ('image' in out && out.image !== null) {
    const img = out.image;
    const ok = typeof img === 'string' && img.startsWith('https://') && img.length <= 300;
    if (!ok) delete out.image;
  }

  return { ok: true, data: out };
}
