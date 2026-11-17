// Loads the shop's first catalogue into the database: ../laf-shop/catalogue/products.csv (names, prices, sizes),
// copy.json (what the site says, packed weights) and the web copies of the photos.
//
//   node --env-file=.env.local scripts/shop-import-catalogue.mjs                         dry run: prints the plan
//   node --env-file=.env.local scripts/shop-import-catalogue.mjs --write                 development
//   node --env-file=.env.local scripts/shop-import-catalogue.mjs --write --sample        development, with sample
//                                                                                        stock and delivery fees
//   node --env-file=.env.prod.local scripts/shop-import-catalogue.mjs --write --production
//
// Safe to run again: a product is matched by its address (slug), an item by its code, a photo by its file. What is
// already there is left exactly as staff have it; nothing is deleted or overwritten. Stock starts at zero (the
// real counts are entered in ArkOS); --sample is refused on production.
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "./lib/db-url.mjs";
import { skuFor } from "../lib/utils/shop.ts";

const args = new Set(process.argv.slice(2));
const WRITE = args.has("--write");
const SAMPLE = args.has("--sample");
if (isProd() && WRITE && !args.has("--production")) throw new Error("This is production: add --production to write there.");
if (!isProd() && args.has("--production")) throw new Error("--production was given but the environment is development.");
if (isProd() && SAMPLE) throw new Error("Sample stock and fees are for development only.");

const ROOT = new URL("../../laf-shop/", import.meta.url);
const file = (p) => new URL(p, ROOT);

/** A small CSV reader: quoted fields, doubled quotes, commas inside quotes. */
function csv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const copy = JSON.parse(readFileSync(file("catalogue/copy.json"), "utf8"));
const rows = csv(readFileSync(file("catalogue/products.csv"), "utf8"));

const plan = rows.map((r, index) => {
  const c = copy[r.id];
  if (!c) throw new Error(`copy.json has no entry for ${r.id}`);
  const base = r.photo.replace(/\.png$/, "");
  const web = (suffix) => `mockups/assets/products/${base}${suffix}.jpg`;
  const twoSided = existsSync(file(web("-front")));
  const sides = twoSided ? (c.first === "back" ? [["-back", "Back"], ["-front", "Front"]] : [["-front", "Front"], ["-back", "Back"]]) : [["", ""]];
  const photos = sides.map(([suffix, label], sort) => {
    if (!existsSync(file(web(suffix)))) throw new Error(`missing web photo ${web(suffix)} (run catalogue/optimise.py)`);
    return { local: web(suffix), path: `products/${r.id}/${suffix ? suffix.slice(1) : "main"}.jpg`, label, alt: `${r.name}${label ? `, ${label.toLowerCase()}` : ""}`, sort };
  });
  const sizes = r.sizes ? r.sizes.split("|").map((s) => s.trim()).filter(Boolean) : [""];
  const price = Number(r.proposed_price_php);
  if (!(price > 0)) throw new Error(`${r.id}: no price`);
  // Only clothing carries its colour on the item (a tee is "White, M"); everything else is one plain item.
  const colour = sizes.length > 1 ? r.colours.split(/ with |,/)[0].trim().slice(0, 40) : "";
  const variants = sizes.map((size, sort) => ({ sku: skuFor(r.id, colour, size), colour, size, price, sort }));
  if (variants.length !== Number(r.items)) throw new Error(`${r.id}: ${variants.length} items made, the sheet says ${r.items}`);
  return {
    slug: r.id, name: r.name, category: r.category, collection: r.collection || null, description: c.description, details: c.details,
    supply: r.supply === "made" ? "made" : "stock", weight: c.grams, status: c.hold ? "draft" : "published", hold: c.hold ?? null, sort: index, variants, photos,
  };
});

const skus = plan.flatMap((p) => p.variants.map((v) => v.sku));
const dupe = skus.find((s, i) => skus.indexOf(s) !== i);
if (dupe) throw new Error(`two items would share the code ${dupe}`);

console.log(`${isProd() ? "PRODUCTION" : "development"}: ${plan.length} products, ${skus.length} items, ${plan.reduce((n, p) => n + p.photos.length, 0)} photos${WRITE ? "" : "  (dry run: nothing is written)"}`);
for (const p of plan) console.log(`  ${p.status === "draft" ? "DRAFT " : "      "}${p.name.padEnd(36)} ${String(p.variants.length).padStart(2)} item(s)  P${String(p.variants[0].price).padStart(5)}  ${p.supply.padEnd(5)}  ${p.photos.length} photo(s)${p.hold ? `  held: ${p.hold}` : ""}`);
if (!WRITE) process.exit(0);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to store the photos.");
if (isProd() !== !url.includes("kptftyuzrnummbcjakro")) throw new Error("The database and the storage address point at different projects.");

const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  if (!(await c.query("select to_regclass('shop.products') as t")).rows[0].t) throw new Error("The shop's tables are not there yet: apply migration 0155 first.");

  // The photo files first (each replaces a file of the same name; a failure stops before any row is written).
  let stored = 0;
  for (const p of plan) for (const f of p.photos) {
    const res = await fetch(`${url}/storage/v1/object/shop/${f.path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "image/jpeg", "Cache-Control": "max-age=31536000", "x-upsert": "true" },
      body: readFileSync(file(f.local)),
    });
    if (!res.ok) throw new Error(`photo ${f.path}: ${res.status} ${(await res.text()).slice(0, 120)}`);
    stored++;
  }

  await c.query("begin");
  const made = { products: 0, variants: 0, photos: 0, stock: 0, fees: 0 };
  for (const p of plan) {
    const ins = await c.query(
      `insert into shop.products (slug, name, category, collection, description, details, supply, weight_grams, status, sort)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (slug) do nothing returning id`,
      [p.slug, p.name, p.category, p.collection, p.description, p.details, p.supply, p.weight, p.status, p.sort]);
    made.products += ins.rowCount;
    const id = ins.rows[0]?.id ?? (await c.query("select id from shop.products where slug = $1", [p.slug])).rows[0].id;
    for (const v of p.variants) {
      made.variants += (await c.query(
        `insert into shop.variants (product_id, sku, colour, size, price, sort) values ($1, $2, nullif($3, ''), nullif($4, ''), $5, $6) on conflict do nothing`,
        [id, v.sku, v.colour, v.size, v.price, v.sort])).rowCount;
    }
    for (const f of p.photos) {
      made.photos += (await c.query(
        `insert into shop.photos (product_id, path, label, alt, sort) values ($1, $2, nullif($3, ''), $4, $5) on conflict (path) do nothing`,
        [id, f.path, f.label, f.alt, f.sort])).rowCount;
    }
  }
  if (SAMPLE) {
    // Development only: 20 pieces on every counted item that has none, and sample delivery fees.
    const s = await c.query(
      `with u as (update shop.variants v set stock = 20 from shop.products p where p.id = v.product_id and p.supply = 'stock' and v.stock = 0 returning v.id)
       insert into shop.stock_moves (variant_id, qty, reason, note, stock_after) select id, 20, 'count', 'Sample stock for testing', 20 from u`);
    made.stock = s.rowCount;
    const fees = [["Metro Manila", 1000, 95], ["Metro Manila", 3000, 150], ["Luzon", 1000, 125], ["Luzon", 3000, 190], ["Visayas", 1000, 155], ["Visayas", 3000, 230], ["Mindanao", 1000, 155], ["Mindanao", 3000, 230]];
    for (const [area, grams, fee] of fees) made.fees += (await c.query(`insert into shop.delivery_fees (area, max_grams, fee) values ($1, $2, $3) on conflict do nothing`, [area, grams, fee])).rowCount;
  }
  await c.query("commit");
  console.log(`\nstored ${stored} photo files; added ${made.products} products, ${made.variants} items, ${made.photos} photos${SAMPLE ? `, sample stock on ${made.stock} items, ${made.fees} sample fees` : ""}. What was already there was left alone.`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  throw e;
} finally {
  await c.end();
}
