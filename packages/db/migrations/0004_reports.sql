CREATE TABLE "report" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"target_id" text NOT NULL,
	"room_code" text,
	"reason" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_target_id_user_id_fk" FOREIGN KEY ("target_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "report_target_idx" ON "report" USING btree ("target_id");
