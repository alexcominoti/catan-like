import { describe, it, expect } from 'vitest';
import { sanitizeUserUpdate } from '../src/user-update.js';

describe('sanitizeUserUpdate (POST /api/auth/update-user)', () => {
  it('bloqueia a troca de username por esta rota', () => {
    // Era o bypass: gravava direto, pulando regex, unicidade e a cota de troca
    // única que só existe em /api/profile/username.
    const r = sanitizeUserUpdate({ username: 'alexandre' });
    expect(r.ok).toBe(false);
  });

  it('bloqueia também a troca de name (que é o nome exibido)', () => {
    expect(sanitizeUserUpdate({ name: 'Outro' }).ok).toBe(false);
    expect(sanitizeUserUpdate({ name: 'x', language: 'en' }).ok).toBe(false);
  });

  it('não atrapalha os updates internos do Better Auth', () => {
    // Confirmação de e-mail, renovação de sessão etc. não mandam nome.
    const r = sanitizeUserUpdate({ emailVerified: true, updatedAt: new Date('2026-01-01') });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.emailVerified).toBe(true);
  });

  it('aceita idioma suportado e descarta o resto', () => {
    const ok = sanitizeUserUpdate({ language: 'en' });
    expect(ok.ok && ok.data.language).toBe('en');
    const lixo = sanitizeUserUpdate({ language: 'klingon' });
    expect(lixo.ok && 'language' in lixo.data).toBe(false);
  });

  it('só guarda avatar https e curto; aceita null para limpar', () => {
    const bom = sanitizeUserUpdate({ image: 'https://exemplo.com/a.png' });
    expect(bom.ok && bom.data.image).toBe('https://exemplo.com/a.png');

    for (const ruim of ['javascript:alert(1)', 'http://sem-tls.com/a.png', 'x'.repeat(400)]) {
      const r = sanitizeUserUpdate({ image: ruim });
      expect(r.ok && 'image' in r.data).toBe(false);
    }

    const limpar = sanitizeUserUpdate({ image: null });
    expect(limpar.ok && limpar.data.image).toBeNull();
  });
});
