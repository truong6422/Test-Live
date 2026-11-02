CREATE TABLE "actions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"cooldown_ms" integer NOT NULL,
	"user_cooldown_ms" integer NOT NULL,
	"priority" integer NOT NULL,
	"lanes" jsonb NOT NULL,
	"boss_effect" jsonb NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collective_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"goal" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"participants" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"reward_title" text
);
--> statement-breakpoint
CREATE TABLE "event_history" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"event_id" text NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"player_id" text,
	"actor_name" text NOT NULL,
	"action_id" text,
	"outcome" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"gift_id" integer NOT NULL,
	"gift_name" text NOT NULL,
	"action_id" text NOT NULL,
	"min_count" integer DEFAULT 1 NOT NULL,
	"min_diamonds" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"tiktok_username" text
);
--> statement-breakpoint
CREATE TABLE "players" (
	"platform_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"total_participations" integer DEFAULT 0 NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"total_diamonds" integer DEFAULT 0 NOT NULL,
	"action_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"granted_titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text DEFAULT 'Nhân viên chăm chỉ' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_players" (
	"session_id" text NOT NULL,
	"player_id" text NOT NULL,
	"participations" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"diamonds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "session_players_session_id_player_id_pk" PRIMARY KEY("session_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collective_events" ADD CONSTRAINT "collective_events_session_id_live_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."live_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_mappings" ADD CONSTRAINT "gift_mappings_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_players" ADD CONSTRAINT "session_players_session_id_live_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_players" ADD CONSTRAINT "session_players_player_id_players_platform_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("platform_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_history_created_at_idx" ON "event_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "event_history_session_idx" ON "event_history" USING btree ("session_id");
