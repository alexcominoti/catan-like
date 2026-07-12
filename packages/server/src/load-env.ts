import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

/**
 * Carrega o `.env` da RAIZ do monorepo — importado ANTES de tudo em `index.ts`,
 * para que qualquer módulo já veja `process.env` preenchido.
 *
 * Por que não `import 'dotenv/config'`: aquele resolve o `.env` pelo cwd do
 * processo, e `npm run dev --workspace @trevalis/server` roda com cwd
 * `packages/server` (onde NÃO existe `.env`) — então as variáveis (DATABASE_URL,
 * TRUSTED_ORIGINS, etc.) não eram lidas e o auth barrava a origem do Vite. Aqui o
 * caminho é relativo AO MÓDULO, então funciona seja rodando da raiz ou do pacote.
 *
 * Em produção (Fly) não há `.env` no caminho: `dotenv` apenas não faz nada e as
 * variáveis vêm do ambiente/secrets (dotenv nunca sobrescreve `process.env`).
 */
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
