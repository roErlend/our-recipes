CREATE TABLE "shopping_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_id" text NOT NULL,
	"item_key" text NOT NULL,
	"name" text NOT NULL,
	"quantity" double precision,
	"unit" text,
	"note" text,
	"source_recipe_id" text,
	"source_title" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shopping_entry" ADD CONSTRAINT "shopping_entry_source_recipe_id_recipe_id_fk" FOREIGN KEY ("source_recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopping_entry_scope_idx" ON "shopping_entry" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "shopping_entry_source_idx" ON "shopping_entry" USING btree ("source_recipe_id");--> statement-breakpoint
ALTER TABLE "recipe" DROP COLUMN "is_active";