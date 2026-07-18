-- Make ingredient_category scope-aware (household-owned categories), mirroring
-- ingredient_catalog. Non-destructive: adds a nullable scope_id (existing rows
-- become global NULL-scope), swaps the single-column primary key for two partial
-- unique indexes. No rows are deleted; existing global names stay unique.
ALTER TABLE "ingredient_category" ADD COLUMN "scope_id" text;--> statement-breakpoint
ALTER TABLE "ingredient_category" DROP CONSTRAINT "ingredient_category_pkey";--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_category_global_uq" ON "ingredient_category" USING btree ("name") WHERE scope_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_category_scope_uq" ON "ingredient_category" USING btree ("scope_id","name") WHERE scope_id is not null;
