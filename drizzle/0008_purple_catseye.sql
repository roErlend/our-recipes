-- Carry every existing single-value override into the per-unit jsonb map
-- (added in 0007) before its columns are dropped — no override value is lost.
UPDATE shopping_check
SET override_amounts = jsonb_build_object(coalesce(lower(override_unit), ''), override_quantity)
WHERE override_quantity IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "shopping_check" DROP COLUMN "override_quantity";--> statement-breakpoint
ALTER TABLE "shopping_check" DROP COLUMN "override_unit";
