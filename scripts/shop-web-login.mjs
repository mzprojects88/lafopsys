// Sets (or resets) the password of shop_web, the shop site's own database login (0155), and writes the site's
// settings file beside the shop project. The password is made here, kept only in that file (and later in the
// site's hosting settings), and never printed. Then it signs in as shop_web through the pooler and proves the
// login can read the open catalogue and nothing else.
//
//   node --env-file=.env.local scripts/shop-web-login.mjs                     development -> ../laf-shop/.env.local
//   node --env-file=.env.prod.local scripts/shop-web-login.mjs --production   production  -> ../laf-shop/.env.production.local
//   ... --check                                                               only test the login already in the file
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "./lib/db-url.mjs";

const args = new Set(process.argv.slice(2));
if (isProd() !== args.has("--production")) throw new Error(isProd() ? "This is production: add --production." : "--production was given but the environment is development.");
const target = new URL(`../../laf-shop/${isProd() ? ".env.production.local" : ".env.local"}`, import.meta.url);
const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!api) throw new Error("NEXT_PUBLIC_SUPABASE_URL is needed for the photo address.");

const owner = new URL(pgUrl());
const ref = owner.username.split(".")[1];
if (!ref || !api.includes(ref)) throw new Error("The database and the API address point at different projects.");

const urlFor = (password, port) => `postgresql://shop_web.${ref}:${encodeURIComponent(password)}@${owner.hostname}:${port}/postgres`;
const readExisting = () => (existsSync(target) ? readFileSync(target, "utf8").match(/^SHOP_DATABASE_URL=(.+)$/m)?.[1]?.trim() ?? null : null);

/** Signs in as shop_web and checks what it may and may not do. Returns null on success, or what went wrong. */
async function probe(url) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
    const who = (await c.query("select current_user as u")).rows[0].u;
    if (who !== "shop_web") return `signed in as ${who}, not shop_web`;
    const cat = (await c.query("select shop.web_catalog() as c")).rows[0].c;
    for (const sql of ["select 1 from shop.products limit 1", "select 1 from ops.patients limit 1", "select 1 from shared.staff limit 1"]) {
      const refused = await c.query(sql).then(() => false, (e) => e.code === "42501");
      if (!refused) return `it could run: ${sql}`;
    }
    return { products: cat.products.length, open: cat.open };
  } catch (e) {
    return `could not sign in: ${String(e.message).slice(0, 140)}`;
  } finally {
    await c.end().catch(() => {});
  }
}

let url = readExisting();
if (!args.has("--check")) {
  const password = randomBytes(30).toString("base64url");
  const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    if (!(await c.query("select 1 from pg_roles where rolname = 'shop_web'")).rowCount) throw new Error("shop_web does not exist: apply migration 0155 first.");
    const { rows } = await c.query("select format('alter role shop_web with login password %L', $1::text) as sql", [password]);
    await c.query(rows[0].sql);
  } finally {
    await c.end();
  }
  // Transaction-mode pooling (6543) suits a site on serverless hosting; each query takes a connection only briefly.
  url = urlFor(password, 6543);
  const site = isProd() ? "https://shop.littlearkfoundation.org" : "http://localhost:3100";
  writeFileSync(target, [`SHOP_DATABASE_URL=${url}`, `NEXT_PUBLIC_PHOTO_ORIGIN=${api}`, `NEXT_PUBLIC_SITE_URL=${site}`, "NEXT_PUBLIC_MAIN_SITE_URL=https://www.littlearkfoundation.org", ""].join("\n"));
  console.log(`password set; settings written to laf-shop/${isProd() ? ".env.production.local" : ".env.local"} (not shown, not committed)`);
}
if (!url) throw new Error("No SHOP_DATABASE_URL in the settings file yet: run without --check first.");

// The pooler may take a moment to learn a new password.
let result = null;
for (let attempt = 1; attempt <= 6; attempt++) {
  result = await probe(url);
  if (typeof result === "object") break;
  await new Promise((r) => setTimeout(r, 5000));
}
if (typeof result === "object") console.log(`OK: shop_web signs in through the pooler, reads the catalogue (${result.products} products on the site, shop ${result.open ? "open" : "closed"}), and is refused the products table, patients and staff.`);
else {
  console.log(`FAILED: ${result}`);
  process.exitCode = 1;
}
