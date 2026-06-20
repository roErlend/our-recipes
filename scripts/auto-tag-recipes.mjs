// Auto-tag recipes from title + ingredient names with a transparent keyword
// engine. Merges with any existing tags (never drops). DRY RUN by default —
// prints what it would do. Pass `apply` to write:
//   node --env-file=.env scripts/auto-tag-recipes.mjs          (dry run)
//   node --env-file=.env scripts/auto-tag-recipes.mjs apply    (writes)
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
const APPLY = process.argv.includes('apply')
const sql = postgres(connectionString, { prepare: false })

const any = (hay, ...words) => words.some((w) => hay.includes(w))

/** Compute the tag set for one recipe from its title + joined ingredient names. */
function computeTags(title, ingredients) {
  const t = title.toLowerCase()
  const h = `${title} ${ingredients}`.toLowerCase()
  const tags = new Set()

  // ---- Primary category: dessert (sweets) else middag --------------------
  const isDessert = any(t, 'ninja', 'skoleboller', 'vafler', 'vaffel', 'froyo', 'frappe')
  if (isDessert) {
    tags.add('dessert')
    // Ninja Creami frozen treats are ice cream; the frappe is a coffee drink.
    if (any(t, 'ninja') && !any(t, 'frappe')) tags.add('iskrem')
  } else {
    tags.add('middag')
  }

  // ---- Dish type ---------------------------------------------------------
  if (/pasta|carbonara|lasagne|spagh?etti|bolognese|gnocch?i|orzo|ragu|tagliatelle|penne|pastaputer/.test(h)) {
    tags.add('pasta')
  }
  if (/pizza|pinsa|focaccia/.test(h)) tags.add('pizza')
  if (any(h, 'suppe', 'ramen', 'tom kah', 'tom ka')) tags.add('suppe')
  if (any(t, 'burger')) tags.add('burger')
  if (any(t, 'grill')) tags.add('grill')
  if (any(h, 'gryte', 'stroganoff', 'stuing', 'bourguignon', 'jegergryte')) tags.add('gryte')

  // ---- Cuisine -----------------------------------------------------------
  // italiensk is decoupled from the generic `pasta` tag: a pasta *side* (e.g.
  // fish cakes with pasta) shouldn't read as Italian cuisine. Only recognizable
  // Italian dishes/ingredients qualify.
  if (/carbonara|lasagne|bolognese|gnocch?i|ragu|pizza|pinsa|focaccia|tuscan|burrata|parmesan|pesto|tagliatelle|spagh?etti|ginpasta|tiktok-pasta/.test(h)) {
    tags.add('italiensk')
  }
  if (any(h, 'taco', 'burrito', 'enchilada', 'nachos', 'quesadilla', 'birria',
    'fajita', 'tacokrydder', 'tacosaus', 'tacolefser', 'tacoskjell',
    'tortillalefser', 'chili con carne', 'meksikansk', 'guacamole', 'salsa')) {
    tags.add('meksikansk')
  }
  if (any(h, 'wok', 'nudler', 'nudel', 'nudle', 'ramen', 'dumpling', 'gyoza',
    'pad thai', 'steam buns', 'bao', 'vårrull', 'stekt ris', 'steikt ris',
    'pokebowl', 'poke', 'teriyaki', 'satay', 'crispy duck', 'crispy pork',
    'crispy rice', 'hoisin', 'soyasaus', 'sriracha', 'fiskesaus', 'sweet chili',
    'rispapir', 'edamame', 'tantan', 'østerssaus', 'sesamolje')) {
    tags.add('asiatisk')
  }
  if (any(h, 'thai', 'rød curry', 'red curry', 'currypaste', 'kokosmelk',
    'tom kah', 'tom ka', 'kokosscampi', 'thaico', 'thaigryte', 'satay')) {
    tags.add('thai')
    tags.add('asiatisk')
  }
  if (any(h, 'tikka', 'tandoori', 'masala', 'butter chicken', 'garam', 'indisk',
    'sarita')) {
    tags.add('indisk')
  }
  if (any(h, 'shawarma', 'falafel', 'halloumi', 'haloumi', 'hummus', 'kebab',
    'doner', 'tzatziki', 'tahini', 'shatta')) {
    tags.add('midtøsten')
  }

  // ---- Protein -----------------------------------------------------------
  // Stock/sauce words are excluded so they don't masquerade as the main protein:
  //  kylling(buljong|fond|kraft) = chicken stock, not chicken; fiskesaus = fish
  //  sauce, not fish. Meat words prefixed by kylling/svine/fiske belong to that
  //  protein, not beef (e.g. "kyllingkjøttdeig" is chicken, not storfe).
  if (/kylling(?!buljong|fond|kraft)|chicken/.test(h)) tags.add('kylling')
  if (/fisk(?!esaus)|laks|torsk|skrei|reker|scampi|plukkfisk|blåkveite|kveite|kamskjell|salma|makrell|tunfisk/.test(h)) {
    tags.add('fisk')
  }
  const beef =
    /biff|storfe|høyrygg|ribeye|indrefilet|mørbrad|entrecote|tuscan beef|chili beef|bourguignon|erlendbiff|karbonade/.test(h) ||
    /(?<!kylling|svine|fiske)kjøtt(deig|kake|bolle|bulla)/.test(h)
  if (beef) tags.add('storfe')
  if (/svin|bacon|spareribs|pork|skinke|nakkekotelett|svineknoke|guanciale|panchetta|pancetta|ribbe|chorizo|pølse|pepperoni/.test(h)) {
    tags.add('svin')
  }
  if (/veggis|vegetar/.test(h)) tags.add('vegetar')

  return [...tags]
}

const recipes = await sql`
  SELECT r.id, r.title, r.tags,
         COALESCE((SELECT string_agg(i.name, ' ') FROM ingredient i WHERE i.recipe_id = r.id), '') AS ing
  FROM recipe r
  ORDER BY r.title
`

const counts = {}
let changed = 0

for (const r of recipes) {
  const computed = computeTags(r.title, r.ing)
  // Merge: keep existing tags, add computed ones (deduped).
  const merged = [...new Set([...(r.tags ?? []), ...computed])]
  for (const tag of merged) counts[tag] = (counts[tag] ?? 0) + 1

  const isChange = merged.length !== (r.tags ?? []).length
  if (isChange) changed++
  console.log(`${r.title}\n   ${JSON.stringify(merged)}`)

  if (APPLY && isChange) {
    await sql`UPDATE recipe SET tags = ${merged}, updated_at = now() WHERE id = ${r.id}`
  }
}

console.log('\n===== TAG COUNTS =====')
for (const [tag, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(4)}  ${tag}`)
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} · ${recipes.length} recipes · ${changed} would change`)

await sql.end()
