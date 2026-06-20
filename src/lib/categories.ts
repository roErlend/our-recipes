/**
 * Grocery categories for the saved-ingredient catalog and shopping-list
 * grouping. Client-safe (no server imports) so both the catalog UI and the
 * shopping list share one canonical, ordered list — the order here is the order
 * sections appear on the shopping list (roughly a walk through the store).
 */
export const INGREDIENT_CATEGORIES = [
  'Frukt og grønt',
  'Kjøtt og fisk',
  'Meieri og egg',
  'Brød og bakeri',
  'Tørrvarer og pasta',
  'Hermetikk og konserves',
  'Krydder og saus',
  'Frysevarer',
  'Drikke',
  'Snacks og godteri',
  'Husholdning',
  'Annet',
] as const

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number]

/** Fallback category for ingredients with no catalog entry / no category. */
export const DEFAULT_CATEGORY: IngredientCategory = 'Annet'

const ORDER = new Map(INGREDIENT_CATEGORIES.map((c, i) => [c, i]))

/** True if `name` is one of the built-in categories (which always exist). */
export function isCanonicalCategory(name: string): boolean {
  return ORDER.has(name as IngredientCategory)
}

/** Sort key for a category — unknown values sort just before "Annet". */
export function categoryRank(category: string): number {
  return ORDER.get(category as IngredientCategory) ?? ORDER.size - 1.5
}

/**
 * Clean a stored category: keep any non-empty value (custom categories are
 * allowed — they sort just before "Annet" via {@link categoryRank}), falling
 * back to the default only for null/blank.
 */
export function normalizeCategory(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : DEFAULT_CATEGORY
}

/**
 * Keyword → category rules for {@link guessIngredientCategory}, checked top to
 * bottom (first match wins). More specific sections come before broader ones, so
 * e.g. "kokosmelk" lands in Hermetikk before "melk" would pull it into Meieri,
 * and "paprikapulver" lands in Krydder before "paprika" pulls it into Frukt.
 * Norwegian compounds mean we match substrings (so "hvetemel" hits "mel"); the
 * two-letter keywords match whole words only, to avoid hits like "te" in "potet".
 */
const CATEGORY_KEYWORDS: [IngredientCategory, string[]][] = [
  ['Husholdning', ['tørkepapir', 'toalettpapir', 'aluminiumsfolie', 'plastfolie', 'bakepapir', 'oppvask', 'såpe', 'vaskemiddel', 'søppelsekk', 'tannkrem']],
  ['Frysevarer', ['frossen', 'frosne', 'fryst', 'dypfryst', 'pommes frites', 'iskrem', 'fiskepinne']],
  ['Hermetikk og konserves', ['hermetisk', 'hermetiske', 'kokosmelk', 'kokoskrem', 'kokos', 'knuste tomater', 'hakkede tomater', 'tomatpuré', 'tomatpure', 'passata', 'kikerter', 'kidneybønner', 'sorte bønner', 'hvite bønner', 'soltørkede']],
  ['Meieri og egg', ['melk', 'fløte', 'flote', 'rømme', 'romme', 'crème fraîche', 'creme fraiche', 'crème', 'creme', 'smør', 'smor', 'ost', 'parmesan', 'mozzarella', 'feta', 'yoghurt', 'skyr', 'kesam', 'cottage', 'egg', 'margarin', 'kefir']],
  ['Kjøtt og fisk', ['kylling', 'kjøttdeig', 'kjottdeig', 'kjøttkake', 'karbonade', 'kjøtt', 'kjott', 'biff', 'okse', 'svin', 'flesk', 'gris', 'bacon', 'pølse', 'polse', 'skinke', 'spekemat', 'laks', 'torsk', 'sei', 'hyse', 'makrell', 'tunfisk', 'fisk', 'reker', 'scampi', 'blåskjell', 'kalkun', 'lammelår', 'lammekjøtt', 'entrecôte', 'entrecote', 'kotelett', 'filet', 'ribbe']],
  ['Brød og bakeri', ['brød', 'brod', 'rundstykk', 'tortilla', 'lefse', 'knekkebrød', 'knekkebrod', 'baguette', 'pita', 'naan', 'focaccia', 'ciabatta']],
  ['Tørrvarer og pasta', ['pasta', 'spaghetti', 'makaroni', 'penne', 'fusilli', 'lasagne', 'tagliatelle', 'ris', 'nudler', 'mel', 'sukker', 'havregryn', 'havre', 'gryn', 'linser', 'bakepulver', 'natron', 'gjær', 'couscous', 'bulgur', 'quinoa', 'semule', 'polenta', 'sirup', 'rosiner']],
  ['Krydder og saus', ['salt', 'pepper', 'olje', 'soyasaus', 'soya', 'fiskesaus', 'østerssaus', 'hoisin', 'worcester', 'saus', 'ketchup', 'sennep', 'majones', 'aioli', 'curry', 'karri', 'spisskummen', 'paprikapulver', 'oregano', 'timian', 'rosmarin', 'kanel', 'vanilje', 'kardemomme', 'gurkemeie', 'muskat', 'nellik', 'buljong', 'fond', 'eddik', 'honning', 'sriracha', 'tahini', 'pesto', 'krydder', 'chiliflak', 'chilipulver', 'laurbær']],
  ['Drikke', ['vann', 'farris', 'brus', 'cola', 'juice', 'kaffe', 'saft', 'smoothie', 'leskedrikk', 'te', 'øl', 'vin']],
  ['Snacks og godteri', ['sjokolade', 'potetgull', 'chips', 'kjeks', 'nøtter', 'notter', 'mandler', 'godteri', 'snacks', 'popcorn']],
  ['Frukt og grønt', ['løk', 'lok', 'hvitløk', 'tomat', 'agurk', 'salat', 'ruccola', 'spinat', 'gulrot', 'gulrøtter', 'potet', 'paprika', 'chili', 'jalapeño', 'jalapeno', 'sopp', 'champignon', 'avokado', 'koriander', 'persille', 'dill', 'gressløk', 'mynte', 'ingefær', 'ingefer', 'sitron', 'lime', 'eple', 'banan', 'appelsin', 'brokkoli', 'blomkål', 'blomkal', 'squash', 'aubergine', 'purre', 'mais', 'kål', 'sjalott', 'vårløk', 'varlok', 'rødløk', 'rodlok', 'selleri', 'fennikel', 'druer', 'bær', 'mango', 'ananas', 'erter', 'bønner']],
]

/**
 * Best-effort grocery category for an ingredient name, by keyword. Used to file
 * a brand-new ingredient (e.g. from an imported recipe) under a sensible section
 * automatically; falls back to {@link DEFAULT_CATEGORY} when nothing matches.
 * Pure and client-safe so it can be unit-tested and reused anywhere.
 */
export function guessIngredientCategory(name: string): IngredientCategory {
  const n = name.trim().toLowerCase()
  if (!n) return DEFAULT_CATEGORY
  const tokens = n.split(/[^a-zæøåäöéè]+/i).filter(Boolean)
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      const hit = kw.length <= 2 ? tokens.includes(kw) : n.includes(kw)
      if (hit) return category
    }
  }
  return DEFAULT_CATEGORY
}
