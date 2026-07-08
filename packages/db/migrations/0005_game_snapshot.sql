CREATE TABLE "game_snapshot" (
	"room_code" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp NOT NULL
);
