ALTER TABLE "shopping_check" ADD COLUMN "override_unit" text;
--> statement-breakpoint

-- Backfill (hand-written): the shopping-list merge key changes from
-- "name__unit" to the name alone, so the same ingredient in different units is
-- one line. Rewrite the stored keys to match, folding any check rows that end
-- up sharing a key. (Pre-flight on 2026-08-04 found zero such collisions, so
-- the fold rules below are a safety net, not expected behavior: a folded line
-- counts as checked only if every part was; the most recently updated override
-- wins, keeping the unit its old key carried.)

-- 1) One folded check row per (scope, name-key).
CREATE TEMPORARY TABLE chk_folded AS
SELECT
  user_id,
  regexp_replace(item_key, '__[^_]*$', '') AS item_key,
  bool_and(checked) AS checked,
  max(updated_at) AS updated_at
FROM shopping_check
GROUP BY user_id, regexp_replace(item_key, '__[^_]*$', '');
--> statement-breakpoint

-- 2) The surviving override per folded key, with the unit recovered from the
--    old key's "__unit" suffix (empty suffix = a bare count → NULL).
CREATE TEMPORARY TABLE ovr_folded AS
SELECT DISTINCT ON (user_id, regexp_replace(item_key, '__[^_]*$', ''))
  user_id,
  regexp_replace(item_key, '__[^_]*$', '') AS item_key,
  override_quantity,
  nullif(substring(item_key FROM '__([^_]*)$'), '') AS override_unit
FROM shopping_check
WHERE override_quantity IS NOT NULL
ORDER BY user_id, regexp_replace(item_key, '__[^_]*$', ''), updated_at DESC;
--> statement-breakpoint

DELETE FROM shopping_check;
--> statement-breakpoint

INSERT INTO shopping_check (user_id, item_key, checked, override_quantity, override_unit, updated_at)
SELECT c.user_id, c.item_key, c.checked, o.override_quantity, o.override_unit, c.updated_at
FROM chk_folded c
LEFT JOIN ovr_folded o ON o.user_id = c.user_id AND o.item_key = c.item_key;
--> statement-breakpoint

-- 3) Entry keys: recompute from the name (the authoritative source).
UPDATE shopping_entry SET item_key = lower(btrim(name)) WHERE item_key <> lower(btrim(name));
