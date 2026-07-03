ALTER TABLE "room" ADD COLUMN "last_activity_at" timestamp DEFAULT now() NOT NULL;
