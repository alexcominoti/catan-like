ALTER TABLE "user" ADD COLUMN "username_changed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "player_stats" ADD COLUMN "current_streak" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "player_stats" ADD COLUMN "longest_streak" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE "room" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"host_user_id" text NOT NULL,
	"config" jsonb,
	"status" text DEFAULT 'waiting' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"max_players" integer DEFAULT 4 NOT NULL,
	"board_layout" text DEFAULT 'standard' NOT NULL,
	"match_id" text,
	"created_at" timestamp NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "room_player" (
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"color" text NOT NULL,
	"seat_index" integer NOT NULL,
	"is_host" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp NOT NULL,
	CONSTRAINT "room_player_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "room_player" ADD CONSTRAINT "room_player_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "room_player" ADD CONSTRAINT "room_player_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "room_code_idx" ON "room" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "room_status_private_idx" ON "room" USING btree ("status","is_private");
--> statement-breakpoint
CREATE INDEX "room_player_room_idx" ON "room_player" USING btree ("room_id");
