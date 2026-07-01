/**
 * Validação de username no cliente — cópia da função pura do servidor
 * (packages/server/src/username.ts). Duplicação intencional: a web não importa o
 * pacote do servidor. Mantenha as duas em sincronia.
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
