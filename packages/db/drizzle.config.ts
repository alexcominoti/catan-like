import { defineConfig } from 'drizzle-kit';

/**
 * Config do drizzle-kit. `db:generate` cria SQL de migration a partir do schema
 * (offline). `db:migrate` aplica no banco (precisa de DATABASE_URL).
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://user:pass@localhost:5432/trevalis',
  },
  strict: true,
  verbose: true,
});
