ALTER TABLE "actions" ADD COLUMN "fish" jsonb;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "total_grams" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "session_players" ADD COLUMN "grams" integer DEFAULT 0 NOT NULL;