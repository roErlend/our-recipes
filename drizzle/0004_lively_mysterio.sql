CREATE TABLE "catalog_seed" (
	"scope_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint

-- Backfill (hand-written): the catalog moves from "global rows merged into every
-- household's view" to "each household owns a full copy; globals are templates".
-- Copy the templates into every existing scope so nobody's visible catalog
-- shrinks. Purely additive: ON CONFLICT keeps a household's existing rows
-- (their copy-on-write forks and custom items win), and no row is deleted.

-- Every existing scope: a user's household_id, or their own id when solo.
-- (Same resolution as accessibleScope in src/server/sharing.ts.)

-- 1) Copy every stock ingredient into each scope (existing household rows win).
INSERT INTO "ingredient_catalog" ("id", "scope_id", "name", "name_key", "category", "staple", "created_at")
SELECT gen_random_uuid()::text, s.scope_id, c."name", c."name_key", c."category", c."staple", now()
FROM (
	SELECT DISTINCT COALESCE(hm."household_id", u."id") AS scope_id
	FROM "user" u
	LEFT JOIN "household_member" hm ON hm."user_id" = u."id"
) s
CROSS JOIN "ingredient_catalog" c
WHERE c."scope_id" IS NULL
ON CONFLICT ("scope_id", "name_key") WHERE "scope_id" IS NOT NULL DO NOTHING;
--> statement-breakpoint

-- 2) Copy every template category (canonical list as of this migration ∪ global
--    rows) into each scope (existing household rows win).
INSERT INTO "ingredient_category" ("name", "scope_id", "created_at")
SELECT t.name, s.scope_id, now()
FROM (
	SELECT DISTINCT COALESCE(hm."household_id", u."id") AS scope_id
	FROM "user" u
	LEFT JOIN "household_member" hm ON hm."user_id" = u."id"
) s
CROSS JOIN (
	SELECT unnest(ARRAY[
		'Frukt og grønt', 'Kjøtt og fisk', 'Meieri og egg', 'Brød og bakeri',
		'Tørrvarer og pasta', 'Hermetikk og konserves', 'Krydder og saus',
		'Frysevarer', 'Drikke', 'Snacks og godteri', 'Husholdning', 'Annet'
	]) AS name
	UNION
	SELECT "name" FROM "ingredient_category" WHERE "scope_id" IS NULL
) t
ON CONFLICT ("scope_id", "name") WHERE "scope_id" IS NOT NULL DO NOTHING;
--> statement-breakpoint

-- 3) Mark every existing scope as seeded so the lazy first-use seeding skips it.
INSERT INTO "catalog_seed" ("scope_id", "created_at")
SELECT DISTINCT COALESCE(hm."household_id", u."id"), now()
FROM "user" u
LEFT JOIN "household_member" hm ON hm."user_id" = u."id"
ON CONFLICT ("scope_id") DO NOTHING;
