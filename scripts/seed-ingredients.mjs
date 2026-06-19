// Seed the ingredient catalog with stock ingredients (scope_id NULL — they
// belong to no one and are visible to everyone). Idempotent: re-running only
// inserts names that aren't already stock. Run with:
//   node --env-file=.env scripts/seed-ingredients.mjs
//
// Plain JS / no extra deps — uses the `postgres` client directly. Categories
// must match src/lib/categories.ts.
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set. Run with: node --env-file=.env scripts/seed-ingredients.mjs')
  process.exit(1)
}

/** [name, category] — keep names in Norwegian, categories matching the app. */
const STOCK = [
  // Frukt og grønt
  ['Banan', 'Frukt og grønt'],
  ['Eple', 'Frukt og grønt'],
  ['Sitron', 'Frukt og grønt'],
  ['Lime', 'Frukt og grønt'],
  ['Appelsin', 'Frukt og grønt'],
  ['Tomat', 'Frukt og grønt'],
  ['Cherrytomater', 'Frukt og grønt'],
  ['Agurk', 'Frukt og grønt'],
  ['Salat', 'Frukt og grønt'],
  ['Løk', 'Frukt og grønt'],
  ['Rødløk', 'Frukt og grønt'],
  ['Vårløk', 'Frukt og grønt'],
  ['Sjalottløk', 'Frukt og grønt'],
  ['Hvitløk', 'Frukt og grønt'],
  ['Ingefær', 'Frukt og grønt'],
  ['Gulrot', 'Frukt og grønt'],
  ['Potet', 'Frukt og grønt'],
  ['Søtpotet', 'Frukt og grønt'],
  ['Brokkoli', 'Frukt og grønt'],
  ['Blomkål', 'Frukt og grønt'],
  ['Paprika', 'Frukt og grønt'],
  ['Chili', 'Frukt og grønt'],
  ['Sopp', 'Frukt og grønt'],
  ['Squash', 'Frukt og grønt'],
  ['Avokado', 'Frukt og grønt'],
  ['Spinat', 'Frukt og grønt'],
  ['Koriander', 'Frukt og grønt'],
  ['Persille', 'Frukt og grønt'],
  ['Basilikum', 'Frukt og grønt'],

  // Kjøtt og fisk
  ['Kyllingfilet', 'Kjøtt og fisk'],
  ['Kyllingkjøttdeig', 'Kjøtt og fisk'],
  ['Kjøttdeig', 'Kjøtt og fisk'],
  ['Karbonadedeig', 'Kjøtt og fisk'],
  ['Svinekjøtt', 'Kjøtt og fisk'],
  ['Bacon', 'Kjøtt og fisk'],
  ['Pølser', 'Kjøtt og fisk'],
  ['Laks', 'Kjøtt og fisk'],
  ['Torsk', 'Kjøtt og fisk'],
  ['Reker', 'Kjøtt og fisk'],

  // Meieri og egg
  ['Melk', 'Meieri og egg'],
  ['Lettmelk', 'Meieri og egg'],
  ['Fløte', 'Meieri og egg'],
  ['Kremfløte', 'Meieri og egg'],
  ['Matfløte', 'Meieri og egg'],
  ['Rømme', 'Meieri og egg'],
  ['Crème fraîche', 'Meieri og egg'],
  ['Smør', 'Meieri og egg'],
  ['Margarin', 'Meieri og egg'],
  ['Egg', 'Meieri og egg'],
  ['Ost', 'Meieri og egg'],
  ['Revet ost', 'Meieri og egg'],
  ['Parmesan', 'Meieri og egg'],
  ['Yoghurt', 'Meieri og egg'],
  ['Kesam', 'Meieri og egg'],

  // Brød og bakeri
  ['Brød', 'Brød og bakeri'],
  ['Rundstykker', 'Brød og bakeri'],
  ['Tortillalefser', 'Brød og bakeri'],
  ['Knekkebrød', 'Brød og bakeri'],

  // Tørrvarer og pasta
  ['Spaghetti', 'Tørrvarer og pasta'],
  ['Pasta', 'Tørrvarer og pasta'],
  ['Ris', 'Tørrvarer og pasta'],
  ['Jasminris', 'Tørrvarer og pasta'],
  ['Nudler', 'Tørrvarer og pasta'],
  ['Hvetemel', 'Tørrvarer og pasta'],
  ['Sukker', 'Tørrvarer og pasta'],
  ['Brunt sukker', 'Tørrvarer og pasta'],
  ['Havregryn', 'Tørrvarer og pasta'],
  ['Linser', 'Tørrvarer og pasta'],
  ['Bakepulver', 'Tørrvarer og pasta'],
  ['Gjær', 'Tørrvarer og pasta'],

  // Hermetikk og konserves
  ['Hermetiske tomater', 'Hermetikk og konserves'],
  ['Knuste tomater', 'Hermetikk og konserves'],
  ['Tomatpuré', 'Hermetikk og konserves'],
  ['Kokosmelk', 'Hermetikk og konserves'],
  ['Kikerter', 'Hermetikk og konserves'],
  ['Sorte bønner', 'Hermetikk og konserves'],
  ['Mais', 'Hermetikk og konserves'],

  // Krydder og saus
  ['Salt', 'Krydder og saus'],
  ['Pepper', 'Krydder og saus'],
  ['Olivenolje', 'Krydder og saus'],
  ['Rapsolje', 'Krydder og saus'],
  ['Soyasaus', 'Krydder og saus'],
  ['Fiskesaus', 'Krydder og saus'],
  ['Sweet chili', 'Krydder og saus'],
  ['Ketchup', 'Krydder og saus'],
  ['Sennep', 'Krydder og saus'],
  ['Majones', 'Krydder og saus'],
  ['Rød curry paste', 'Krydder og saus'],
  ['Karri', 'Krydder og saus'],
  ['Spisskummen', 'Krydder og saus'],
  ['Paprikapulver', 'Krydder og saus'],
  ['Oregano', 'Krydder og saus'],
  ['Buljong', 'Krydder og saus'],
  ['Eddik', 'Krydder og saus'],
  ['Honning', 'Krydder og saus'],

  // Frysevarer
  ['Erter', 'Frysevarer'],
  ['Frosne bær', 'Frysevarer'],
  ['Pommes frites', 'Frysevarer'],
  ['Is', 'Frysevarer'],

  // Drikke
  ['Vann', 'Drikke'],
  ['Brus', 'Drikke'],
  ['Juice', 'Drikke'],
  ['Kaffe', 'Drikke'],
  ['Te', 'Drikke'],
  ['Øl', 'Drikke'],
  ['Vin', 'Drikke'],

  // Snacks og godteri
  ['Sjokolade', 'Snacks og godteri'],
  ['Potetgull', 'Snacks og godteri'],
  ['Kjeks', 'Snacks og godteri'],
  ['Nøtter', 'Snacks og godteri'],

  // Husholdning
  ['Toalettpapir', 'Husholdning'],
  ['Tørkepapir', 'Husholdning'],
  ['Oppvaskmiddel', 'Husholdning'],
  ['Søppelsekker', 'Husholdning'],
  ['Aluminiumsfolie', 'Husholdning'],
  ['Bakepapir', 'Husholdning'],
]

const sql = postgres(connectionString, { prepare: false })

try {
  let inserted = 0
  for (const [name, category] of STOCK) {
    const nameKey = name.trim().toLowerCase()
    const rows = await sql`
      INSERT INTO ingredient_catalog (id, scope_id, name, name_key, category, created_at)
      VALUES (gen_random_uuid()::text, NULL, ${name}, ${nameKey}, ${category}, now())
      ON CONFLICT (name_key) WHERE scope_id IS NULL DO NOTHING
      RETURNING id
    `
    inserted += rows.length
  }
  console.log(`Seeded ${inserted} new stock ingredient(s) (${STOCK.length} in list).`)
} catch (err) {
  console.error('Seeding failed:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
