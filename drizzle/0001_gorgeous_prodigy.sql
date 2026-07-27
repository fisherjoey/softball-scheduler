CREATE TABLE "softball"."lineup_meta" (
	"game_id" uuid PRIMARY KEY NOT NULL,
	"grid_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grid_score" real,
	"grid_seed" integer,
	"batting_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"batting_pattern" jsonb
);
--> statement-breakpoint
ALTER TABLE "softball"."lineup_meta" ADD CONSTRAINT "lineup_meta_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "softball"."games"("id") ON DELETE cascade ON UPDATE no action;