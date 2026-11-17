// The 0155 pre-flight (the shop's catalogue), on the development database and ALWAYS rolled back: applies the
// migration in a transaction and proves who may read and write the catalogue, that stock changes only through its
// function, and that the public site's login (shop_web) can run the storefront function and nothing else.
//   node --env-file=.env.local scripts/rls/shop-matrix.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";

if (isProd() || !pgUrl().includes("kptftyuzrnummbcjakro")) throw new Error("dev only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
let pass = 0, fail = 0;

/** Runs one statement as a staff member (a uuid), as the shop site's login ("shop_web"), signed out ("anon") or as
 * the owner (null), inside a savepoint that is always rolled back unless `keep` is set. */
async function step(name, who, sql, params, expect, keep = false) {
  await c.query("savepoint s");
  let r;
  try {
    if (who === "shop_web" || who === "anon") {
      await c.query("select set_config('request.jwt.claims', '{}', true)");
      await c.query(`set local role ${who}`);
    } else {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who ? { sub: who, role: "authenticated" } : {})]);
      if (who) await c.query("set local role authenticated");
    }
    await c.query("discard plans");
    const q = await c.query(sql, params);
    r = { ok: true, rows: q.rows, n: q.rowCount };
  } catch (e) {
    r = { ok: false, error: e.message, code: e.code };
  }
  if (keep && r.ok) {
    await c.query("reset role");
    await c.query("release savepoint s");
  } else {
    await c.query("rollback to savepoint s");
    await c.query("reset role");
  }
  const good = expect(r);
  if (good) pass++;
  else fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name}  ${r.ok ? `rows=${r.n}` : `${r.code} ${r.error.slice(0, 90)}`}`);
  return r;
}
const refused = (r) => !r.ok && r.code === "42501";
const rows = (n) => (r) => r.ok && r.n === n;
const failsWith = (code) => (r) => !r.ok && r.code === code;

try {
  await c.query("begin");
  await c.query(readFileSync(new URL("../../supabase/migrations/0155_shop_catalogue.sql", import.meta.url), "utf8"));
  // The checks count their own rows: whatever the shop holds on development is set aside for this run (rolled back).
  const tables = (await c.query("select string_agg(format('shop.%I', tablename), ', ') t from pg_tables where schemaname = 'shop' and tablename not in ('settings', 'order_counters')")).rows[0].t;
  await c.query(`truncate ${tables}`);
  await c.query("update shop.settings set shop_open = false, pickup_enabled = true, pickup_address = '', pickup_note = ''");
  // For this check only (rolled back): let the owner act as the site's login, so its limits are really exercised.
  await c.query("grant shop_web to current_user");
  const canSet = (await c.query("select pg_has_role(current_user, 'shop_web', 'SET') as ok")).rows[0].ok;
  if (!canSet) throw new Error("cannot act as shop_web: its limits would not be tested");
  const ids = (await c.query(`select
    (select id from shared.staff where role = 'admin' and active order by id limit 1) admin,
    (select id from shared.staff where role = 'finance' and active order by id limit 1) finance,
    (select id from shared.staff where role = 'driver' and active order by id limit 1) driver,
    (select id from shared.staff where active and role not in ('admin', 'finance', 'driver', 'partner_viewer') order by id limit 1) shop`)).rows[0];
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);
  // Another account stands in for the new role (rolled back with everything else).
  await c.query(`update shared.staff set role = 'shop_staff', extra_roles = '{}' where id = $1`, [ids.shop]);

  const P = "11111111-1111-4111-8111-111111111111", V = "22222222-2222-4222-8222-222222222222", D = "33333333-3333-4333-8333-333333333333";
  const product = `insert into shop.products (id, slug, name, category, status) values ($1, 'test-tee', 'Test Tee', 'Apparel', 'published')`;

  console.log("-- the menu and the role");
  await step("the Shop Staff role exists, as an ordinary role", null, `select 1 from shared.roles where key = 'shop_staff' and not built_in`, [], rows(1));
  await step("Shop Staff: module level is edit", ids.shop, `select shared.module_level('shop') as l`, [], (r) => r.ok && r.rows[0].l === "edit");
  await step("Finance: module level is view", ids.finance, `select shared.module_level('shop') as l`, [], (r) => r.ok && r.rows[0].l === "view");
  await step("a driver: module level is none", ids.driver, `select shared.module_level('shop') as l`, [], (r) => r.ok && r.rows[0].l === "none");
  await step("the Super Admin: module level is edit", ids.admin, `select shared.module_level('shop') as l`, [], (r) => r.ok && r.rows[0].l === "edit");

  console.log("-- the catalogue");
  await step("Finance cannot add a product", ids.finance, product, [P], refused);
  await step("a driver cannot add a product", ids.driver, product, [P], refused);
  await step("Shop Staff add a product", ids.shop, product, [P], rows(1), true);
  await step("the product records who changed it", null, `select 1 from shop.products where id = $1 and updated_by = $2`, [P, ids.shop], rows(1));
  await step("a bad address (slug) is refused", ids.shop, `insert into shop.products (slug, name, category) values ('Bad Slug', 'X Y', 'Apparel')`, [], failsWith("23514"));
  await step("Shop Staff add an item", ids.shop, `insert into shop.variants (id, product_id, sku, size, price, cost) values ($1, $2, 'TEST-TEE-M', 'M', 450, 190)`, [V, P], rows(1), true);
  await step("an item cannot be added with a count already on it", ids.shop, `insert into shop.variants (product_id, sku, size, price, stock) values ($1, 'TEST-TEE-L', 'L', 450, 50)`, [P], refused);
  await step("the same size twice is refused", ids.shop, `insert into shop.variants (product_id, sku, size, price) values ($1, 'TEST-TEE-M2', ' m ', 450)`, [P], failsWith("23505"));
  await step("a price of zero is refused", ids.shop, `insert into shop.variants (product_id, sku, size, price) values ($1, 'TEST-TEE-S', 'S', 0)`, [P], failsWith("23514"));
  await step("Shop Staff add a photo", ids.shop, `insert into shop.photos (product_id, path, label) values ($1, 'products/test-tee/front.jpg', 'Front')`, [P], rows(1), true);
  await step("a photo outside the products folder is refused", ids.shop, `insert into shop.photos (product_id, path) values ($1, '../secret.jpg')`, [P], failsWith("23514"));
  await step("Finance reads the catalogue", ids.finance, `select 1 from shop.products`, [], rows(1));
  await step("a driver reads nothing", ids.driver, `select 1 from shop.products`, [], rows(0));
  await step("Finance cannot change a price", ids.finance, `update shop.variants set price = 1 where id = $1`, [V], rows(0));
  await step("a signed-out visitor is refused", "anon", `select 1 from shop.products`, [], refused);

  console.log("-- stock");
  await step("Shop Staff cannot write the count directly", ids.shop, `update shop.variants set stock = 99 where id = $1`, [V], refused);
  await step("nor what is held", ids.shop, `update shop.variants set held = 0 where id = $1`, [V], refused);
  await step("Finance cannot change stock", ids.finance, `select shop.stock_change($1, 10, 'received', null)`, [V], refused);
  await step("Shop Staff receive 10 pieces", ids.shop, `select shop.stock_change($1, 10, 'received', 'First delivery') as n`, [V], (r) => r.ok && r.rows[0].n === 10, true);
  await step("the change is on the trail, with who and the count after", null, `select 1 from shop.stock_moves where variant_id = $1 and qty = 10 and stock_after = 10 and by_staff_id = $2 and note = 'First delivery'`, [V, ids.shop], rows(1));
  await step("damaged takes pieces off", ids.shop, `select shop.stock_change($1, -3, 'damaged', null) as n`, [V], (r) => r.ok && r.rows[0].n === 7);
  await step("more than there are cannot come off", ids.shop, `select shop.stock_change($1, -11, 'count', null)`, [V], failsWith("23514"));
  await step("'received' cannot take pieces off", ids.shop, `select shop.stock_change($1, -1, 'received', null)`, [V], failsWith("22023"));
  await step("'sold' is not a reason staff may use", ids.shop, `select shop.stock_change($1, -1, 'sold', null)`, [V], failsWith("22023"));
  await step("nobody edits the trail", ids.shop, `delete from shop.stock_moves`, [], refused);
  await step("nobody writes the trail by hand", ids.shop, `insert into shop.stock_moves (variant_id, qty, reason, stock_after) values ($1, 5, 'received', 15)`, [V], refused);

  console.log("-- settings and delivery fees");
  await step("Shop Staff set a delivery fee", ids.shop, `insert into shop.delivery_fees (id, area, max_grams, fee) values ($1, 'Metro Manila', 1000, 95)`, [D], rows(1), true);
  await step("an unknown area is refused", ids.shop, `insert into shop.delivery_fees (area, max_grams, fee) values ('Abroad', 1000, 500)`, [], failsWith("23514"));
  await step("Finance cannot change the settings", ids.finance, `update shop.settings set shop_open = true`, [], rows(0));
  await step("Shop Staff open the shop", ids.shop, `update shop.settings set shop_open = true, pickup_address = 'Test address'`, [], rows(1), true);
  await step("the settings cannot be deleted", ids.shop, `delete from shop.settings`, [], refused);
  await step("nor a second row added", ids.shop, `insert into shop.settings (id) values (false)`, [], refused);

  console.log("-- the public site's login");
  const cat = await step("the site reads the open catalogue", "shop_web", `select shop.web_catalog() as c`, [], (r) => r.ok && r.rows[0].c.products.length === 1);
  const prod = cat.ok ? cat.rows[0].c.products[0] : null;
  const item = prod?.variants?.[0];
  const check = (name, good) => { if (good) pass++; else fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name}`); };
  check("it shows the price and how many are left", item?.price === 450 && item?.left === 10);
  check("it never shows the cost or the reorder point", item && !("cost" in item) && !("reorder_at" in item) && !("stock" in item));
  check("it carries the shop's settings and the delivery fee", cat.ok && cat.rows[0].c.open === true && cat.rows[0].c.delivery.length === 1 && cat.rows[0].c.pickup.address === "Test address");
  await c.query("savepoint d");
  await c.query(`update shop.products set status = 'draft' where id = $1`, [P]);
  await step("a draft product is left out of the site", "shop_web", `select jsonb_array_length(shop.web_catalog() -> 'products') as n`, [], (r) => r.ok && r.rows[0].n === 0);
  await c.query("rollback to savepoint d");
  await c.query("savepoint e");
  await c.query(`delete from shop.photos where product_id = $1`, [P]);
  await step("a product without a photo is left out of the site", "shop_web", `select jsonb_array_length(shop.web_catalog() -> 'products') as n`, [], (r) => r.ok && r.rows[0].n === 0);
  await c.query("rollback to savepoint e");
  await step("the site cannot read the products table", "shop_web", `select 1 from shop.products`, [], refused);
  await step("the site cannot read the items' cost", "shop_web", `select cost from shop.variants`, [], refused);
  await step("the site cannot change stock", "shop_web", `select shop.stock_change($1, 5, 'received', null)`, [V], refused);
  await step("the site cannot write a product", "shop_web", `insert into shop.products (slug, name, category) values ('x-y', 'X Y', 'Apparel')`, [], refused);
  await step("the site cannot see patients", "shop_web", `select 1 from ops.patients limit 1`, [], refused);
  await step("the site cannot see staff", "shop_web", `select 1 from shared.staff limit 1`, [], refused);
  await step("the site cannot see donors", "shop_web", `select 1 from ops.donors limit 1`, [], refused);
  await step("the site cannot see the cash book", "shop_web", `select 1 from ops.cash_entries limit 1`, [], refused);
  await step("the site cannot see Inventory", "shop_web", `select 1 from inventory.items limit 1`, [], refused);
  await step("staff cannot run the site's function", ids.shop, `select shop.web_catalog()`, [], refused);
  await step("a signed-out visitor cannot run it either", "anon", `select shop.web_catalog()`, [], refused);

  console.log("-- photos in storage");
  await step("the bucket is public, 2 MB, pictures only", null, `select 1 from storage.buckets where id = 'shop' and public and file_size_limit = 2097152 and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']`, [], rows(1));
  await step("Shop Staff add a photo file", ids.shop, `insert into storage.objects (bucket_id, name, owner) values ('shop', 'products/test-tee/front.jpg', $1)`, [ids.shop], rows(1));
  await step("Finance cannot add a photo file", ids.finance, `insert into storage.objects (bucket_id, name, owner) values ('shop', 'products/test-tee/x.jpg', $1)`, [ids.finance], refused);
  await step("a driver cannot add a photo file", ids.driver, `insert into storage.objects (bucket_id, name, owner) values ('shop', 'products/test-tee/x.jpg', $1)`, [ids.driver], refused);
  await step("Shop Staff cannot write into the patients' bucket through this", ids.shop, `insert into storage.objects (bucket_id, name, owner) values ('patient-documents', 'x/y.jpg', $1)`, [ids.shop], refused);
} catch (e) {
  fail++;
  console.log("STOPPED:", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
