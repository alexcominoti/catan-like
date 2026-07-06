import { describe, expect, it } from 'vitest';
import { sanitizeChatText, CHAT_MAX_LEN } from '../src/chat.js';

describe('sanitizeChatText', () => {
  it('colapsa espaços e apara as pontas', () => {
    expect(sanitizeChatText('  oi    pessoal  ')).toBe('oi pessoal');
  });

  it('descarta vazio / só espaços / não-string', () => {
    expect(sanitizeChatText('   ')).toBe('');
    expect(sanitizeChatText('')).toBe('');
    expect(sanitizeChatText(undefined)).toBe('');
    expect(sanitizeChatText(42)).toBe('');
  });

  it('remove caracteres de controle (vira espaço)', () => {
    expect(sanitizeChatText('ola\x00\x07mundo')).toBe('ola mundo');
    expect(sanitizeChatText('linha1\nlinha2')).toBe('linha1 linha2');
  });

  it('corta no tamanho máximo', () => {
    const long = 'a'.repeat(CHAT_MAX_LEN + 50);
    expect(sanitizeChatText(long)).toHaveLength(CHAT_MAX_LEN);
  });
});
