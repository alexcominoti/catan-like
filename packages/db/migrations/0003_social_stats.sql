ALTER TABLE "player_stats" ADD COLUMN "games_completed" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "player_stats" ADD COLUMN "games_abandoned" integer DEFAULT 0 NOT NULL;
