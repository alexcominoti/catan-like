/**
 * Validação de username (nome de usuário) — função PURA, sem I/O.
 *
 * Regra (espelhada no cliente em apps/web/src/auth/username.ts — duplicação
 * intencional: o servidor não é importável pela web e o engine deve ficar puro):
 *   ^(?=.*[A-Za-z0-9]$)[A-Za-z][A-Za-z\d.-]{3,19}$
 *
 * Ou seja: 4–20 caracteres; começa com letra; termina em letra/dígito; no meio
 * só letras, dígitos, ponto (.) e hífen (-); sem espaços nem outros especiais.
 */
export const USERNAME_REGEX = /^(?=.*[A-Za-z0-9]$)[A-Za-z][A-Za-z\d.-]{3,19}$/;

/** Retorna uma mensagem de erro (PT-BR) ou `null` se o username é válido. */
export function validateUsername(name: unknown): string | null {
  if (typeof name !== 'string') return 'Nome de usuário inválido.';
  const u = name.trim();
  if (u.length < 4 || u.length > 20) {
    return 'O nome de usuário deve ter entre 4 e 20 caracteres.';
  }
  if (!/^[A-Za-z]/.test(u)) return 'O nome de usuário deve começar com uma letra.';
  if (!/[A-Za-z0-9]$/.test(u)) return 'O nome de usuário deve terminar com letra ou número.';
  if (!USERNAME_REGEX.test(u)) {
    return 'Use apenas letras, números, ponto (.) e hífen (-), sem espaços.';
  }
  return null;
}
