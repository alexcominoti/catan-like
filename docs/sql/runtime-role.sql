-- ---------------------------------------------------------------------------
-- Role de menor privilégio para o runtime do Trevalis (Fase 2 da auditoria).
--
-- Problema que resolve: hoje a aplicação e as migrations usam a MESMA role, que
-- é dona do schema. Ou seja, a conexão que atende requisição da internet também
-- pode DROP TABLE. Um SQL injection (hoje não há — tudo é Drizzle parametrizado)
-- ou uma falha em qualquer dependência passa a valer o banco inteiro em vez de
-- valer as linhas que o app já poderia ler e escrever de qualquer forma.
--
-- Depois de aplicar:
--   DATABASE_URL            -> trevalis_app   (o servidor; só CRUD)
--   MIGRATION_DATABASE_URL  -> role dona      (só o release_command do Fly)
-- `migrate.ts` prefere MIGRATION_DATABASE_URL e cai em DATABASE_URL se ela não
-- existir, então dá para aplicar isto sem parar nada.
--
-- Rode CONECTADO COMO A ROLE DONA, no banco da aplicação.
-- Troque a senha antes de executar.
-- ---------------------------------------------------------------------------

-- 1. A role da aplicação. Só login; nenhum privilégio de esquema.
CREATE ROLE trevalis_app WITH LOGIN PASSWORD 'TROQUE-ESTA-SENHA';

-- 2. Pode enxergar o schema, mas não criar objetos nele.
GRANT CONNECT ON DATABASE trevalis TO trevalis_app;  -- ajuste o nome do banco
GRANT USAGE ON SCHEMA public TO trevalis_app;
REVOKE CREATE ON SCHEMA public FROM trevalis_app;

-- 3. CRUD nas tabelas que existem hoje. Sem DDL: nada de DROP, ALTER ou TRUNCATE.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO trevalis_app;

-- 4. As sequences das colunas serial/identity (senão o INSERT falha).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO trevalis_app;

-- 5. Tabelas CRIADAS PELAS PRÓXIMAS MIGRATIONS já nascem acessíveis.
--    Sem isto, a primeira migration nova derruba o app com "permission denied".
--    Precisa rodar como a role dona — o default se aplica a quem cria o objeto.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO trevalis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO trevalis_app;

-- 6. A tabela de controle do Drizzle é só das migrations; o app não encosta.
REVOKE ALL ON TABLE drizzle.__drizzle_migrations FROM trevalis_app;

-- ---------------------------------------------------------------------------
-- Conferir (rode como trevalis_app — as duas primeiras devem funcionar e a
-- terceira TEM de falhar com "permission denied"):
--
--   SELECT count(*) FROM "user";
--   INSERT INTO notification (...) VALUES (...);
--   DROP TABLE notification;
--
-- Voltar atrás, se precisar:
--   DROP OWNED BY trevalis_app;
--   DROP ROLE trevalis_app;
-- ---------------------------------------------------------------------------
