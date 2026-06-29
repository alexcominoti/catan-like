/**
 * Schema do banco (Drizzle + Postgres).
 *
 * Duas camadas:
 *  1. Tabelas exigidas pelo Better Auth (user/session/account/verification).
 *     Os nomes e colunas seguem o contrato do Better Auth; nao renomear sem
 *     atualizar a config de auth. `image` = avatar; campos extras (username,
 *     preferences) sao `additionalFields` declarados aqui e na config de auth.
 *  2. Tabelas de produto, "prontas para o futuro" (amigos, partidas, ranking,
 *     estatisticas, inventario, conquistas). Comecam simples — a ideia e ter a
 *     estrutura e as FKs no lugar para evoluir sem migrations dolorosas.
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ */
/* 1. Better Auth — nucleo de contas                                   */
/* ------------------------------------------------------------------ */

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified')
      .$defaultFn(() => false)
      .notNull(),
    image: text('image'), // avatar (opcional)
    // Campos extras do produto (declarados como additionalFields no auth):
    username: text('username'),
    preferences: jsonb('preferences').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    emailIdx: uniqueIndex('user_email_idx').on(t.email),
    usernameIdx: uniqueIndex('user_username_idx').on(t.username),
  }),
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    tokenIdx: uniqueIndex('session_token_idx').on(t.token),
    userIdx: index('session_user_idx').on(t.userId),
  }),
);

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'), // hash da senha (algoritmo moderno: scrypt do Better Auth)
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
  },
  (t) => ({
    identifierIdx: index('verification_identifier_idx').on(t.identifier),
  }),
);

/* ------------------------------------------------------------------ */
/* 2. Produto — pronto para o futuro (amigos, partidas, ranking...)    */
/* ------------------------------------------------------------------ */

/** Amizades: aresta direcionada com status; (requester, addressee) unicos. */
export const friendship = pgTable(
  'friendship',
  {
    requesterId: text('requester_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addresseeId: text('addressee_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // 'pending' | 'accepted' | 'blocked'
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.requesterId, t.addresseeId] }),
    addresseeIdx: index('friendship_addressee_idx').on(t.addresseeId),
  }),
);

/** Partida jogada (uma linha por jogo concluido/abandonado). */
export const match = pgTable('match', {
  id: text('id').primaryKey(),
  seed: integer('seed').notNull(),
  // Config (mapa, ritmo, pontos...) e log de acoes para replay deterministico.
  config: jsonb('config').$type<Record<string, unknown>>(),
  // 'in_progress' | 'finished' | 'abandoned'
  status: text('status').notNull().default('in_progress'),
  winnerUserId: text('winner_user_id').references(() => user.id, {
    onDelete: 'set null',
  }),
  startedAt: timestamp('started_at')
    .$defaultFn(() => new Date())
    .notNull(),
  finishedAt: timestamp('finished_at'),
});

/** Participacao de um usuario numa partida (assento + resultado). */
export const matchPlayer = pgTable(
  'match_player',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => match.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    color: text('color').notNull(),
    points: integer('points').notNull().default(0),
    won: boolean('won').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchId, t.userId] }),
    userIdx: index('match_player_user_idx').on(t.userId),
  }),
);

/** Estatisticas agregadas + ranking (1 linha por usuario). */
export const playerStats = pgTable('player_stats', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  gamesPlayed: integer('games_played').notNull().default(0),
  gamesWon: integer('games_won').notNull().default(0),
  // Pontuacao de ranking (ex.: Elo); default neutro.
  rating: integer('rating').notNull().default(1000),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull(),
});

/** Inventario: itens cosmeticos/colecionaveis por usuario. */
export const inventoryItem = pgTable(
  'inventory_item',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // 'avatar_frame' | 'board_skin' | 'piece_set' | ...
    kind: text('kind').notNull(),
    itemKey: text('item_key').notNull(),
    quantity: integer('quantity').notNull().default(1),
    acquiredAt: timestamp('acquired_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    userIdx: index('inventory_user_idx').on(t.userId),
  }),
);

/** Conquistas desbloqueadas. */
export const achievement = pgTable(
  'achievement',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    unlockedAt: timestamp('unlocked_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.key] }),
  }),
);

/** Conjunto completo do schema — passado ao drizzleAdapter do Better Auth. */
export const schema = {
  user,
  session,
  account,
  verification,
  friendship,
  match,
  matchPlayer,
  playerStats,
  inventoryItem,
  achievement,
};
