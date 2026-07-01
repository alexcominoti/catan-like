import { describe, it, expect } from 'vitest';
import { validateUsername, USERNAME_REGEX } from '../src/username.js';

describe('validateUsername', () => {
  it('aceita nomes válidos', () => {
    for (const ok of ['marina', 'marina.dev', 'rafa-2', 'joao123', 'a1.b-c', 'User']) {
      expect(validateUsername(ok), ok).toBeNull();
      expect(USERNAME_REGEX.test(ok), ok).toBe(true);
    }
  });

  it('rejeita comprimento fora de 4–20', () => {
    expect(validateUsername('abc')).toMatch(/entre 4 e 20/);
    expect(validateUsername('a'.repeat(21))).toMatch(/entre 4 e 20/);
  });

  it('exige começar com letra', () => {
    expect(validateUsername('1abc')).toMatch(/começar com uma letra/);
    expect(validateUsername('.abc')).toMatch(/começar com uma letra/);
  });

  it('exige terminar com letra ou número', () => {
    expect(validateUsername('abc.')).toMatch(/terminar com letra ou número/);
    expect(validateUsername('abc-')).toMatch(/terminar com letra ou número/);
  });

  it('rejeita espaços e caracteres especiais (exceto . e -)', () => {
    for (const bad of ['ab cd', 'ab_cd', 'ab@cd', 'ab!cd', 'açúcar']) {
      expect(validateUsername(bad), bad).not.toBeNull();
    }
  });

  it('rejeita entradas não-string', () => {
    expect(validateUsername(undefined)).not.toBeNull();
    expect(validateUsername(123)).not.toBeNull();
  });
});
