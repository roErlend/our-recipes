// One-off backfill: ensure every existing recipe's ingredients are first-class
// entries in the household ingredient catalog, so recipe-derived shopping-list
// items get a real category (instead of falling back to "Annet") and can be
// re-filed from the admin page. Mirrors what `ensureCatalogIngredients` does at
// recipe-save / add-to-shopping time, applied retroactively to old recipes.
//
// Insert-only and idempotent: it never touches or recategorizes an ingredient
// that already exists (household row or shared stock) — it only adds the missing
// ones, with a guessed category. DRY RUN by default; pass `apply` to write:
//   node --env-file=.env scripts/backfill-recipe-catalog.ts          (dry run)
//   node --env-file=.env scripts/backfill-recipe-catalog.ts apply    (writes)
//
// Category is resolved by name at read time in getShoppingList, so once a name
// is catalogued, items already sitting on the list show the right category on
// the next load — no need to re-add the recipe.
import postgres from 'postgres'

import { guessIngredientCategory } from '../src/lib/categories.ts'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set. Run with: node --env-file=.env scripts/backfill-recipe-catalog.ts',
  )
  process.exit(1)
}

const APPLY = process.argv.includes('apply')
const nameKey = (name: string) => name.trim().toLowerCase()

const sql = postgres(connectionString, { prepare: false })

try {
  // Every ingredient line paired with its recipe's owner.
  const lines = await sql<{ ownerId: string; name: string }[]>`
    SELECT r.created_by AS "ownerId", i.name AS name
    FROM ingredient i
    JOIN recipe r ON r.id = i.recipe_id
  `

  // Owner -> household scope (a user with no membership row is their own household).
  const members = await sql<{ userId: string; householdId: string }[]>`
    SELECT user_id AS "userId", household_id AS "householdId" FROM household_member
  `
  const householdOf = new Map(members.map((m) => [m.userId, m.householdId]))
  const scopeFor = (ownerId: string) => householdOf.get(ownerId) ?? ownerId

  // household -> Map(nameKey -> original name) of every ingredient it uses.
  const byHousehold = new Map<string, Map<string, string>>()
  for (const { ownerId, name } of lines) {
    const key = nameKey(name)
    if (!key) continue
    const scope = scopeFor(ownerId)
    let names = byHousehold.get(scope)
    if (!names) byHousehold.set(scope, (names = new Map()))
    if (!names.has(key)) names.set(key, name.trim())
  }

  // Names already known to each household: its own rows OR shared stock.
  const catalog = await sql<{ scopeId: string | null; nameKey: string }[]>`
    SELECT scope_id AS "scopeId", name_key AS "nameKey" FROM ingredient_catalog
  `
  const stockKeys = new Set(
    catalog.filter((c) => c.scopeId == null).map((c) => c.nameKey),
  )
  const householdKeys = new Map<string, Set<string>>()
  for (const c of catalog) {
    if (c.scopeId == null) continue
    let set = householdKeys.get(c.scopeId)
    if (!set) householdKeys.set(c.scopeId, (set = new Set()))
    set.add(c.nameKey)
  }

  // Compute the rows to insert.
  const toInsert: { scopeId: string; name: string; nameKey: string; category: string }[] = []
  for (const [scope, names] of byHousehold) {
    const known = householdKeys.get(scope)
    for (const [key, name] of names) {
      if (stockKeys.has(key) || known?.has(key)) continue
      toInsert.push({ scopeId: scope, name, nameKey: key, category: guessIngredientCategory(name) })
    }
  }

  console.log(
    `${byHousehold.size} household(s), ${lines.length} ingredient lines. ` +
      `${toInsert.length} new catalog row(s) to add.`,
  )
  // Show a category breakdown so a wall of "Annet" is obvious before writing.
  const byCat = new Map<string, number>()
  for (const r of toInsert) byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1)
  for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${cat}`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with `apply` to write.')
    for (const r of toInsert.slice(0, 40)) {
      console.log(`  + ${r.name}  →  ${r.category}`)
    }
    if (toInsert.length > 40) console.log(`  … and ${toInsert.length - 40} more`)
  } else {
    let inserted = 0
    for (const r of toInsert) {
      const rows = await sql`
        INSERT INTO ingredient_catalog (id, scope_id, name, name_key, category, created_at)
        VALUES (gen_random_uuid()::text, ${r.scopeId}, ${r.name}, ${r.nameKey}, ${r.category}, now())
        ON CONFLICT (scope_id, name_key) WHERE scope_id IS NOT NULL DO NOTHING
        RETURNING id
      `
      inserted += rows.length
    }
    console.log(`\nInserted ${inserted} new catalog row(s).`)
  }
} catch (err) {
  console.error('Backfill failed:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
