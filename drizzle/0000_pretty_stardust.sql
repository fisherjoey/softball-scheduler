CREATE SCHEMA "softball";
--> statement-breakpoint
CREATE TABLE "softball"."batting_orders" (
	"game_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"player_id" uuid,
	CONSTRAINT "batting_orders_game_id_slot_pk" PRIMARY KEY("game_id","slot")
);
--> statement-breakpoint
CREATE TABLE "softball"."game_attendance" (
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"is_present" boolean DEFAULT true NOT NULL,
	"arrived_inning" integer DEFAULT 1 NOT NULL,
	"left_inning" integer,
	CONSTRAINT "game_attendance_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "softball"."games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"opponent" text,
	"notes" text,
	"innings" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "softball"."lineups" (
	"game_id" uuid NOT NULL,
	"inning" integer NOT NULL,
	"position" text NOT NULL,
	"player_id" uuid NOT NULL,
	CONSTRAINT "lineups_game_id_inning_position_pk" PRIMARY KEY("game_id","inning","position")
);
--> statement-breakpoint
CREATE TABLE "softball"."player_positions" (
	"player_id" uuid NOT NULL,
	"position" text NOT NULL,
	"tier" text NOT NULL,
	CONSTRAINT "player_positions_player_id_position_pk" PRIMARY KEY("player_id","position")
);
--> statement-breakpoint
CREATE TABLE "softball"."players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_female" boolean DEFAULT false NOT NULL,
	"is_sub" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "softball"."batting_orders" ADD CONSTRAINT "batting_orders_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "softball"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "softball"."batting_orders" ADD CONSTRAINT "batting_orders_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "softball"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "softball"."game_attendance" ADD CONSTRAINT "game_attendance_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "softball"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "softball"."game_attendance" ADD CONSTRAINT "game_attendance_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "softball"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "softball"."lineups" ADD CONSTRAINT "lineups_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "softball"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "softball"."lineups" ADD CONSTRAINT "lineups_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "softball"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "softball"."player_positions" ADD CONSTRAINT "player_positions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "softball"."players"("id") ON DELETE cascade ON UPDATE no action;