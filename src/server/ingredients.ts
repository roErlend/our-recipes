import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { catalogSeed, ingredientCatalog, ingredientCategory } from '@/db/schema'
import {
  categoryRank,
  DEFAULT_CATEGORY,
  guessIngredientCategory,
  INGREDIENT_CATEGORIES,
  isCanonicalCategory,
  normalizeCategory,
} from '@/lib/categories'
import { requireUser } from '@/server/auth'
import { accessibleScope } from '@/server/sharing'

export interface CatalogIngredient {
  name: string
  /** Lower-cased lookup key, used for client-side filtering/ranking. */
  key: string
  category: string
  /** A pantry staple the household (almost) always has — kept off the "to buy" list. */
  isStaple: boolean
}

/** Lower-cased lookup/dedup key for an ingredient name. */
export function nameKey(name: string) {
  return name.trim().toLowerCase()
}

/**
 * Pure, client-safe autocomplete ranking over a preloaded catalog: prefix
 * matches first, then shorter names, then alphabetical. The whole catalog is
 * small, so filtering happens on the client (no per-keystroke round-trip).
 */
export function filterIngredients(
  all: CatalogIngredient[],
  query: string,
  limit = 8,
): CatalogIngredient[] {
  const q = nameKey(query)
  const matches = q ? all.filter((c) => c.key.includes(q)) : all
  return [...matches]
    .sort((a, b) => {
      const ap = a.key.startsWith(q) ? 0 : 1
      const bp = b.key.startsWith(q) ? 0 : 1
      if (ap !== bp) return ap - bp
      return a.name.localeCompare(b.name, 'nb')
    })
    .slice(0, limit)
}

/* ------------------------------ template seeding -------------------------- */

/**
 * Copy every template (stock) ingredient into a household's scope. Existing
 * household rows win (`onConflictDoNothing` on the scope unique index), so this
 * is safe both for first-use seeding and for a reset re-copy after the wipe.
 * Server-only; runs inside the caller's transaction.
 */
export const seedScopeIngredients = createServerOnlyFn(
  async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], householdId: string) => {
    const templates = await tx
      .select({
        name: ingredientCatalog.name,
        nameKey: ingredientCatalog.nameKey,
        category: ingredientCatalog.category,
        staple: ingredientCatalog.staple,
      })
      .from(ingredientCatalog)
      .where(isNull(ingredientCatalog.scopeId))
    if (!templates.length) return
    await tx
      .insert(ingredientCatalog)
      .values(templates.map((t) => ({ ...t, scopeId: householdId })))
      .onConflictDoNothing()
  },
)

/**
 * Copy every template category (the canonical list ∪ global rows) into a
 * household's scope. Existing household rows win. Server-only; runs inside the
 * caller's transaction.
 */
export const seedScopeCategories = createServerOnlyFn(
  async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], householdId: string) => {
    const globals = await tx
      .select({ name: ingredientCategory.name })
      .from(ingredientCategory)
      .where(isNull(ingredientCategory.scopeId))
    const names = new Set<string>(INGREDIENT_CATEGORIES)
    for (const g of globals) names.add(g.name)
    await tx
      .insert(ingredientCategory)
      .values([...names].map((name) => ({ name, scopeId: householdId })))
      .onConflictDoNothing()
  },
)

/**
 * Initialize a household's catalog from the templates exactly once (a brand-new
 * scope has nothing yet). The `catalog_seed` marker makes this a cheap SELECT on
 * every later call — and keeps a household that deliberately emptied its catalog
 * from being silently re-seeded. Called at the top of every catalog read.
 */
export const ensureScopeSeeded = createServerOnlyFn(
  async (householdId: string) => {
    const [seeded] = await db
      .select({ scopeId: catalogSeed.scopeId })
      .from(catalogSeed)
      .where(eq(catalogSeed.scopeId, householdId))
      .limit(1)
    if (seeded) return
    await db.transaction(async (tx) => {
      await seedScopeIngredients(tx, householdId)
      await seedScopeCategories(tx, householdId)
      await tx
        .insert(catalogSeed)
        .values({ scopeId: householdId })
        .onConflictDoNothing()
    })
  },
)

/* ------------------------------ catalog reads ----------------------------- */

/**
 * The catalog a household sees: its **own rows only** (its copy of the templates
 * plus whatever it added — template rows are never read directly). Returns a Map
 * of nameKey -> { name, category, isStaple }. Server-only; shared by the
 * autocomplete and the shopping-list categorization.
 */
export const catalogForScope = createServerOnlyFn(async (householdId: string) => {
  await ensureScopeSeeded(householdId)
  const rows = await db
    .select({
      name: ingredientCatalog.name,
      nameKey: ingredientCatalog.nameKey,
      category: ingredientCatalog.category,
      staple: ingredientCatalog.staple,
    })
    .from(ingredientCatalog)
    .where(eq(ingredientCatalog.scopeId, householdId))

  const byKey = new Map<string, { name: string; category: string; isStaple: boolean }>()
  for (const r of rows) {
    byKey.set(r.nameKey, {
      name: r.name,
      category: normalizeCategory(r.category),
      isStaple: r.staple,
    })
  }
  return byKey
})

/**
 * Persist a **global template** category row so it survives independently of any
 * ingredient using it. No-op for canonical categories (they're always part of
 * the template set). Server-only; used by the admin template editor.
 */
export const ensureCategoryRow = createServerOnlyFn(
  async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], name: string) => {
    const trimmed = name.trim()
    if (!trimmed || isCanonicalCategory(trimmed)) return
    await tx
      .insert(ingredientCategory)
      .values({ name: trimmed, scopeId: null })
      .onConflictDoNothing()
  },
)

/**
 * Ensure a household-scoped category row exists for a category the household is
 * using. Households own their whole category set (seeded from the templates), so
 * this inserts unconditionally — including for canonical names a household may
 * have deleted and is now re-introducing. Server-only.
 */
export const ensureHouseholdCategoryRow = createServerOnlyFn(
  async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], name: string, householdId: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    await tx
      .insert(ingredientCategory)
      .values({ name: trimmed, scopeId: householdId })
      .onConflictDoNothing()
  },
)

/**
 * All category names available to the current household: its own category rows
 * ∪ any category currently used by its catalog rows (so nothing a household
 * relies on can disappear from pickers). Ordered the way the shopping list
 * groups them.
 */
export const listCategories = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string[]> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    await ensureScopeSeeded(householdId)
    const [named, used] = await Promise.all([
      db
        .select({ name: ingredientCategory.name })
        .from(ingredientCategory)
        .where(eq(ingredientCategory.scopeId, householdId)),
      db
        .selectDistinct({ category: ingredientCatalog.category })
        .from(ingredientCatalog)
        .where(eq(ingredientCatalog.scopeId, householdId)),
    ])
    const set = new Set<string>([DEFAULT_CATEGORY])
    for (const r of named) set.add(r.name)
    for (const r of used) if (r.category) set.add(r.category)
    return [...set].sort(
      (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'nb'),
    )
  },
)

/**
 * The full ingredient catalog of the current household, for the add-box
 * autocomplete. Preloaded and cached via TanStack Query, then filtered
 * client-side with {@link filterIngredients}.
 */
export const listIngredients = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CatalogIngredient[]> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)

    const catalog = await catalogForScope(householdId)
    return [...catalog.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
  },
)

/**
 * Save an ingredient to the household catalog (idempotent). Used when the user
 * types a name the autocomplete didn't find and chooses a category for it.
 * Updates the category if the row already exists. Server-only — called from
 * `addManualItem`, not exposed as its own endpoint.
 */
export const saveHouseholdIngredient = createServerOnlyFn(
  async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], householdId: string, name: string, category: string) => {
    const key = nameKey(name)
    if (!key) return
    const cat = normalizeCategory(category)

    const [existing] = await tx
      .select({ id: ingredientCatalog.id })
      .from(ingredientCatalog)
      .where(
        and(
          eq(ingredientCatalog.scopeId, householdId),
          eq(ingredientCatalog.nameKey, key),
        ),
      )
      .limit(1)

    if (existing) {
      await tx
        .update(ingredientCatalog)
        .set({ category: cat })
        .where(eq(ingredientCatalog.id, existing.id))
    } else {
      await tx.insert(ingredientCatalog).values({
        scopeId: householdId,
        name: name.trim(),
        nameKey: key,
        category: cat,
      })
    }

    // Make the chosen category first-class for this household.
    await ensureHouseholdCategoryRow(tx, cat, householdId)
  },
)

/**
 * Ensure every given ingredient name exists in the household's catalog, creating
 * a row (with a {@link guessIngredientCategory} category) for any that don't —
 * existing rows are left untouched. Used when saving a recipe so its ingredients
 * (especially imported ones) feed the shopping-list autocomplete and get a
 * sensible category. Names are deduped; blanks are skipped. Server-only; runs
 * inside the caller's transaction.
 */
export const ensureCatalogIngredients = createServerOnlyFn(
  async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], householdId: string, names: string[]) => {
    const byKey = new Map<string, string>()
    for (const raw of names) {
      const name = raw.trim()
      const key = nameKey(name)
      if (key && !byKey.has(key)) byKey.set(key, name)
    }
    if (!byKey.size) return

    // Skip names the household's catalog already knows.
    const existing = await tx
      .select({ nameKey: ingredientCatalog.nameKey })
      .from(ingredientCatalog)
      .where(
        and(
          inArray(ingredientCatalog.nameKey, [...byKey.keys()]),
          eq(ingredientCatalog.scopeId, householdId),
        ),
      )
    const existingKeys = new Set(existing.map((r) => r.nameKey))

    const rows = [...byKey.entries()]
      .filter(([key]) => !existingKeys.has(key))
      .map(([key, name]) => ({
        scopeId: householdId,
        name,
        nameKey: key,
        category: guessIngredientCategory(name),
      }))
    if (!rows.length) return

    // onConflictDoNothing guards against a race on the household unique index.
    await tx.insert(ingredientCatalog).values(rows).onConflictDoNothing()
  },
)

/* ------------------ household catalog management (/ingredienser) ---------- */

export interface HouseholdCatalogRow {
  id: string
  name: string
  category: string
  staple: boolean
}

/**
 * The catalog as the household manages it: every row belongs to the household
 * (its copy of the templates plus its own additions), so everything is editable
 * and deletable.
 */
export const listHouseholdCatalog = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HouseholdCatalogRow[]> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    await ensureScopeSeeded(householdId)
    const rows = await db
      .select({
        id: ingredientCatalog.id,
        name: ingredientCatalog.name,
        category: ingredientCatalog.category,
        staple: ingredientCatalog.staple,
      })
      .from(ingredientCatalog)
      .where(eq(ingredientCatalog.scopeId, householdId))

    return rows
      .map((r) => ({ ...r, category: normalizeCategory(r.category) }))
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category, 'nb') ||
          a.name.localeCompare(b.name, 'nb'),
      )
  },
)

/**
 * Create or edit a household ingredient. Every row on `/ingredienser` is the
 * household's own, so edits happen in place (rename allowed). Pass `id: null`
 * to create a new ingredient.
 */
export const saveHouseholdCatalogItem = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().min(1).nullable().optional(),
        name: z.string().trim().min(1, 'Navn kreves').max(200),
        category: z.string().trim().min(1).max(60),
        staple: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const category = normalizeCategory(data.category)
    const displayName = data.name.trim()
    const key = nameKey(displayName)

    await db.transaction(async (tx) => {
      if (data.id) {
        const [row] = await tx
          .select({ id: ingredientCatalog.id, scopeId: ingredientCatalog.scopeId, nameKey: ingredientCatalog.nameKey })
          .from(ingredientCatalog)
          .where(eq(ingredientCatalog.id, data.id))
          .limit(1)
        // Only the household's own rows are reachable/editable here — template
        // rows and other households' rows are off-limits.
        if (!row || row.scopeId !== householdId) {
          throw new Error('Ingrediensen finnes ikke')
        }

        if (key !== row.nameKey) {
          const [clash] = await tx
            .select({ id: ingredientCatalog.id })
            .from(ingredientCatalog)
            .where(
              and(
                eq(ingredientCatalog.scopeId, householdId),
                eq(ingredientCatalog.nameKey, key),
                ne(ingredientCatalog.id, row.id),
              ),
            )
            .limit(1)
          if (clash) throw new Error('Ingrediensen finnes allerede')
        }
        await tx
          .update(ingredientCatalog)
          .set({
            name: displayName,
            nameKey: key,
            category,
            ...(data.staple === undefined ? {} : { staple: data.staple }),
          })
          .where(eq(ingredientCatalog.id, row.id))
        await ensureHouseholdCategoryRow(tx, category, householdId)
        return
      }

      // New ingredient — upsert by name so re-adding an existing one just
      // updates it instead of failing on the unique index.
      const [existing] = await tx
        .select({ id: ingredientCatalog.id })
        .from(ingredientCatalog)
        .where(
          and(
            eq(ingredientCatalog.scopeId, householdId),
            eq(ingredientCatalog.nameKey, key),
          ),
        )
        .limit(1)
      if (existing) {
        await tx
          .update(ingredientCatalog)
          .set({
            name: displayName,
            category,
            ...(data.staple === undefined ? {} : { staple: data.staple }),
          })
          .where(eq(ingredientCatalog.id, existing.id))
      } else {
        await tx.insert(ingredientCatalog).values({
          scopeId: householdId,
          name: displayName,
          nameKey: key,
          category,
          staple: data.staple ?? false,
        })
      }
      await ensureHouseholdCategoryRow(tx, category, householdId)
    })
    return { ok: true }
  })

/**
 * Delete one of the household's catalog ingredients. The scope check guarantees
 * a household can only remove its own rows — never a template or another
 * household's. A reset brings back anything that came from the templates.
 */
export const deleteHouseholdCatalogItem = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const [row] = await db
      .select({ scopeId: ingredientCatalog.scopeId })
      .from(ingredientCatalog)
      .where(eq(ingredientCatalog.id, data.id))
      .limit(1)
    if (!row) throw new Error('Ingrediensen finnes ikke')
    if (row.scopeId !== householdId) {
      throw new Error('Du kan bare slette husholdningens egne ingredienser')
    }
    await db.delete(ingredientCatalog).where(eq(ingredientCatalog.id, data.id))
    return { ok: true }
  })

export interface HouseholdCategoryRow {
  name: string
  /** How many of the household's ingredients use it. */
  count: number
}

/**
 * Categories as the household manages them: its own rows plus any category its
 * catalog rows still use (e.g. after a categories reset), each with a count of
 * the household's ingredients using it.
 */
export const listHouseholdCategories = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HouseholdCategoryRow[]> => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    await ensureScopeSeeded(householdId)
    const [catRows, items] = await Promise.all([
      db
        .select({ name: ingredientCategory.name })
        .from(ingredientCategory)
        .where(eq(ingredientCategory.scopeId, householdId)),
      db
        .select({ category: ingredientCatalog.category })
        .from(ingredientCatalog)
        .where(eq(ingredientCatalog.scopeId, householdId)),
    ])

    const counts = new Map<string, number>()
    for (const r of items) {
      const c = normalizeCategory(r.category)
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    const names = new Set<string>([DEFAULT_CATEGORY, ...counts.keys()])
    for (const r of catRows) names.add(r.name)

    return [...names]
      .map((name) => ({ name, count: counts.get(name) ?? 0 }))
      .sort(
        (a, b) =>
          categoryRank(a.name) - categoryRank(b.name) ||
          a.name.localeCompare(b.name, 'nb'),
      )
  },
)

/** Create a household category (idempotent). */
export const createHouseholdCategory = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z.object({ name: z.string().trim().min(1).max(60) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    await db.transaction(async (tx) => {
      await ensureHouseholdCategoryRow(tx, data.name, householdId)
    })
    return { name: data.name.trim() }
  })

/**
 * Rename one of the household's categories: retags the household's ingredients
 * and swaps the category row. Renaming onto an existing category merges into it.
 * Only this household is affected.
 */
export const renameHouseholdCategory = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        from: z.string().trim().min(1),
        to: z.string().trim().min(1).max(60),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    const to = data.to.trim()
    await db.transaction(async (tx) => {
      await tx
        .update(ingredientCatalog)
        .set({ category: to })
        .where(
          and(
            eq(ingredientCatalog.scopeId, householdId),
            eq(ingredientCatalog.category, data.from),
          ),
        )
      await ensureHouseholdCategoryRow(tx, to, householdId)
      await tx
        .delete(ingredientCategory)
        .where(
          and(
            eq(ingredientCategory.name, data.from),
            eq(ingredientCategory.scopeId, householdId),
          ),
        )
    })
    return { from: data.from, to }
  })

/**
 * Delete one of the household's categories: reassigns the household's
 * ingredients under it to the default and drops the category row. The default
 * category itself can't be deleted (it's the reassignment target). No ingredient
 * is deleted.
 */
export const deleteHouseholdCategory = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z.object({ name: z.string().trim().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    if (data.name === DEFAULT_CATEGORY) {
      throw new Error('Kan ikke slette standardkategorien')
    }
    await db.transaction(async (tx) => {
      await tx
        .update(ingredientCatalog)
        .set({ category: DEFAULT_CATEGORY })
        .where(
          and(
            eq(ingredientCatalog.scopeId, householdId),
            eq(ingredientCatalog.category, data.name),
          ),
        )
      await tx
        .delete(ingredientCategory)
        .where(
          and(
            eq(ingredientCategory.name, data.name),
            eq(ingredientCategory.scopeId, householdId),
          ),
        )
    })
    return { name: data.name }
  })

/* ------------------------------ template resets --------------------------- */

/**
 * Replace the household's entire ingredient list with a fresh copy of the
 * templates. **Destructive**: the household's own additions and edits are gone
 * afterwards — the UI gates this behind an explicit confirmation.
 */
export const resetHouseholdCatalog = createServerFn({ method: 'POST' }).handler(
  async () => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    await db.transaction(async (tx) => {
      await tx
        .delete(ingredientCatalog)
        .where(eq(ingredientCatalog.scopeId, householdId))
      await seedScopeIngredients(tx, householdId)
    })
    return { ok: true }
  },
)

/**
 * Replace the household's categories with a fresh copy of the templates.
 * **Destructive** for the category list (own categories disappear) — the UI
 * gates this behind an explicit confirmation. Ingredients keep the category
 * text they had; a now-template-less category lives on as a "used" category
 * until its ingredients are re-filed.
 */
export const resetHouseholdCategories = createServerFn({ method: 'POST' }).handler(
  async () => {
    const user = await requireUser()
    const { householdId } = await accessibleScope(user.id)
    await db.transaction(async (tx) => {
      await tx
        .delete(ingredientCategory)
        .where(eq(ingredientCategory.scopeId, householdId))
      await seedScopeCategories(tx, householdId)
    })
    return { ok: true }
  },
)

export { DEFAULT_CATEGORY }
