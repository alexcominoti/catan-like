/**
 * Cliente Postgres (Drizzle). Conexao via `DATABASE_URL` (Neon/Fly Postgres).
 *
 * NUNCA hardcode credenciais — `DATABASE_URL` vem do ambiente (`.env` em dev,
 * secret no Fly em producao). `getDb()` e preguicoso: o resto do app (jogo
 * hotseat, bots) roda sem banco; so quem precisa de contas chama isto.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { schema } from './schema.js';

export * from './schema.js';
export { schema };

let _pool: pg.Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

/** Retorna (e memoiza) o Drizzle db. Lanca se `DATABASE_URL` nao estiver setada. */
export function getDb(): NodePgDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL nao definida. Configure o Postgres (Neon) no .env / secrets do Fly.',
    );
  }
  _pool = new pg.Pool({
    connectionString: url,
    // Neon e a maioria dos provedores gerenciados exigem TLS.
    ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_MAX ?? 10),
  });
  _db = drizzle(_pool, { schema });
  return _db;
}

/** Ha banco configurado? Util para degradar com elegancia quando nao ha. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export type Db = NodePgDatabase<typeof schema>;
