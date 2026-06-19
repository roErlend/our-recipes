CREATE TABLE "ingredient_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_id" text,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"category" text DEFAULT 'Annet' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ingredient_catalog_name_idx" ON "ingredient_catalog" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_catalog_stock_uq" ON "ingredient_catalog" USING btree ("name_key") WHERE scope_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_catalog_scope_uq" ON "ingredient_catalog" USING btree ("scope_id","name_key") WHERE scope_id is not null;