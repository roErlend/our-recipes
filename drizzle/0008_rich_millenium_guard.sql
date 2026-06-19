CREATE TABLE "recipe_rating" (
	"recipe_id" text NOT NULL,
	"user_id" text NOT NULL,
	"score" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recipe_rating_recipe_id_user_id_pk" PRIMARY KEY("recipe_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "recipe_rating" ADD CONSTRAINT "recipe_rating_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_rating" ADD CONSTRAINT "recipe_rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_rating_recipe_idx" ON "recipe_rating" USING btree ("recipe_id");