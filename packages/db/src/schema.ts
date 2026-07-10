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
    // O jogador pode trocar o username UMA vez (cota). true = cota já usada.
    usernameChanged: boolean('username_changed')
      .$defaultFn(() => false)
      .notNull(),
    // Idioma preferido (pt-BR | en) — usado nos e-mails transacionais. Espelha a
    // escolha do cliente (localStorage) via PATCH /api/profile.
    language: text('language'),
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
  // Sequencia de vitorias: atual (zera ao perder) e o recorde historico.
  currentStreak: integer('current_streak').notNull().default(0),
  longestStreak: integer('longest_streak').notNull().default(0),
  // Karma (anti-abandono, estilo Colonist): partidas levadas ate o fim conectado
  // vs. partidas abandonadas (a vaga humana virou bot antes do fim). A % de karma
  // e derivada desses dois (ver karma.ts) — mostrada no perfil.
  gamesCompleted: integer('games_completed').notNull().default(0),
  gamesAbandoned: integer('games_abandoned').notNull().default(0),
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

/* ------------------------------------------------------------------ */
/* 3. Salas (lobby online): metadados duraveis p/ listagem e link       */
/* ------------------------------------------------------------------ */

/**
 * Sala de jogo. Os METADADOS duram no banco (listagem publica + ciclo do link);
 * o GameState vivo continua so na memoria do servidor (GameRoom). Uma sala nasce
 * 'waiting' (juntando jogadores), vira 'in_progress' quando o host inicia e
 * 'finished'/'abandoned' ao terminar. `code` e o id curto compartilhado no link.
 */
export const room = pgTable(
  'room',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(), // id curto do link (/room/<code>)
    name: text('name').notNull(),
    hostUserId: text('host_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    config: jsonb('config').$type<Record<string, unknown>>(),
    // 'waiting' | 'in_progress' | 'finished' | 'abandoned'
    status: text('status').notNull().default('waiting'),
    isPrivate: boolean('is_private').notNull().default(false),
    maxPlayers: integer('max_players').notNull().default(4),
    boardLayout: text('board_layout').notNull().default('standard'),
    matchId: text('match_id').references(() => match.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    // Última atividade (criação/entrada/heartbeat da sala de espera). Usada para
    // expirar salas 'waiting' inativas (limpeza automática — sem isso o lobby
    // acumula salas de teste que nunca começam).
    lastActivityAt: timestamp('last_activity_at')
      .$defaultFn(() => new Date())
      .notNull(),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
  },
  (t) => ({
    codeIdx: uniqueIndex('room_code_idx').on(t.code),
    // Listagem publica: salas 'waiting' e nao privadas.
    listIdx: index('room_status_private_idx').on(t.status, t.isPrivate),
  }),
);

/** Assento humano numa sala (host + quem entrou). Bots nao entram aqui. */
export const roomPlayer = pgTable(
  'room_player',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    color: text('color').notNull(),
    seatIndex: integer('seat_index').notNull(),
    isHost: boolean('is_host').notNull().default(false),
    joinedAt: timestamp('joined_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roomId, t.userId] }),
    roomIdx: index('room_player_room_idx').on(t.roomId),
  }),
);

/**
 * Snapshot do GameState VIVO de uma partida em andamento (persistência restart-safe).
 * O motor autoritativo (GameRoom) vive na memória do servidor; sem isto, um deploy
 * ou queda de máquina derruba as partidas ativas. Aqui gravamos o estado completo
 * (JSON serializável) por `room_code`, com debounce, e restauramos o GameRoom no
 * boot/reconexão. Uma linha por sala em andamento (apagada ao terminar/abandonar).
 */
export const gameSnapshot = pgTable('game_snapshot', {
  roomCode: text('room_code').primaryKey(), // 1:1 com a sala (id curto do link)
  state: jsonb('state').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull(),
});

/** Denúncia de um jogador (abuso no chat) — moderação. Sem UI de admin ainda:
 *  fica gravada para revisão. */
export const report = pgTable(
  'report',
  {
    id: text('id').primaryKey(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    roomCode: text('room_code'),
    reason: text('reason'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    targetIdx: index('report_target_idx').on(t.targetId),
  }),
);

/**
 * Notificações persistentes (sino do header). Substitui o InviteStore em memória:
 * uma linha por evento entregue a `userId`, com estado lido/não-lido (`readAt`),
 * data (`createdAt`) e expiração de 30 dias (poda lazy na leitura). `actorId` é
 * quem causou o evento (para username + ação de aceitar/entrar). Tipos:
 * 'room_invite' | 'friend_request' | 'friend_accepted'. `data` guarda o payload
 * (ex.: { code } da sala do convite). Reconectar e amigos online NÃO entram aqui
 * (são estados ao vivo, derivados na hora).
 */
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'cascade' }),
    data: jsonb('data').$type<Record<string, unknown>>(),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    // Feed do usuário: mais recentes primeiro.
    userIdx: index('notification_user_idx').on(t.userId, t.createdAt),
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
  room,
  roomPlayer,
  gameSnapshot,
  report,
  notification,
};
