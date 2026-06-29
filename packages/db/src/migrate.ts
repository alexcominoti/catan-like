/**
 * Aplica as migrations (pasta ./migrations) usando o migrator do Drizzle.
 * Rodar com: `npm run db:migrate -w @trevalis/db` (precisa de DATABASE_URL).
 * Idempotente: o Drizzle registra o que ja aplicou em `__drizzle_migrations`.
 */
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carrega o .env da RAIZ do monorepo (em dev). Em producao (Fly) o env ja vem
// injetado e o arquivo nao existe — `config()` apenas nao encontra nada.
config({ path: join(__dirname, '..', '..', '..', '.env') });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL nao definida.');
  const pool = new pg.Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
    max: 1,
  });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: join(__dirname, '..', 'migrations') });
  await pool.end();
  // eslint-disable-next-line no-console
  console.log('[trevalis] migrations aplicadas.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[trevalis] falha ao migrar:', err);
  process.exit(1);
});
