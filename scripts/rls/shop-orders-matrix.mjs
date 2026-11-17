// The 0156 pre-flight (shop orders, held stock, payment), on the development database and ALWAYS rolled back.
// It applies the migration in a transaction, then plays the customer's steps as the public site's login (shop_web)
// and checks the money, the stock, the payment rules and who may read orders.
//   node --env-file=.env.local scripts/rls/shop-orders-matrix.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";

if (isProd() || !pgUrl().includes("kptftyuzrnummbcjakro")) throw new Error("dev only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
let pass = 0, fail = 0;
const check = (name, good, extra = "") => { if (good) pass++; else fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name}${good ? "" : `  ${extra}`}`); };

/** Runs a statement as a staff member (uuid), the site's login ("shop_web"), signed out ("anon") or the owner (null).
 * Kept (not rolled back) when `keep` is set and it succeeded. */
async function run(who, sql, params = [], keep = false) {
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
  if (keep && r.ok) { await c.query("reset role"); await c.query("release savepoint s"); }
  else { await c.query("rollback to savepoint s"); await c.query("reset role"); }
  return r;
}
const site = (fn, args, keep = false) => run("shop_web", `select shop.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a)), keep);
const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];

try {
  await c.query("begin");
  await c.query(readFileSync(new URL("../../supabase/migrations/0156_shop_orders.sql", import.meta.url), "utf8"));
  await c.query("grant shop_web to current_user");
  if (!(await one("select pg_has_role(current_user, 'shop_web', 'SET') as ok")).ok) throw new Error("cannot act as shop_web: its limits would not be tested");
  const ids = await one(`select
    (select id from shared.staff where role = 'admin' and active order by id limit 1) admin,
    (select id from shared.staff where role = 'finance' and active order by id limit 1) finance,
    (select id from shared.staff where role = 'driver' and active order by id limit 1) driver`);
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);

  // A catalogue of our own, so the counts are known: a counted tee (3 of M, 0 of L), a made-to-order hoodie, a draft.
  const TEE = "aaaaaaaa-0000-4000-8000-000000000001", TEE_M = "aaaaaaaa-0000-4000-8000-000000000011", TEE_L = "aaaaaaaa-0000-4000-8000-000000000012";
  const HOOD = "aaaaaaaa-0000-4000-8000-000000000002", HOOD_S = "aaaaaaaa-0000-4000-8000-000000000021";
  const DRAFT = "aaaaaaaa-0000-4000-8000-000000000003", DRAFT_V = "aaaaaaaa-0000-4000-8000-000000000031";
  await c.query(`delete from shop.delivery_fees`);
  await c.query(`insert into shop.delivery_fees (area, max_grams, fee) values ('Metro Manila', 1000, 95), ('Metro Manila', 3000, 150), ('Luzon', 1000, 125)`);
  await c.query(`insert into shop.products (id, slug, name, category, supply, weight_grams, status) values
    ($1, 'zz-test-tee', 'Test Tee', 'Apparel', 'stock', 200, 'published'), ($2, 'zz-test-hoodie', 'Test Hoodie', 'Apparel', 'made', 600, 'published'), ($3, 'zz-test-draft', 'Test Draft', 'Apparel', 'stock', 100, 'draft')`, [TEE, HOOD, DRAFT]);
  await c.query(`insert into shop.variants (id, product_id, sku, colour, size, price, cost, stock) values
    ($1, $4, 'ZZ-TEE-M', 'White', 'M', 450, 190, 3), ($2, $4, 'ZZ-TEE-L', 'White', 'L', 450, 190, 0), ($3, $5, 'ZZ-HOOD-S', null, 'S', 1250, 600, 0), ($6, $7, 'ZZ-DRAFT', null, null, 100, null, 5)`, [TEE_M, TEE_L, HOOD_S, TEE, HOOD, DRAFT_V, DRAFT]);
  await c.query(`update shop.settings set shop_open = false, pickup_enabled = true, pickup_address = 'Test', hold_minutes = 60`);
  const person = (over = {}) => ({ name: "Sample Customer", email: "Sample.Customer@example.com", phone: "0917 000 0000", delivery: "courier", area: "Metro Manila", province: "Metro Manila", city: "Quezon City", barangay: "Roxas", postal_code: "1103", address_line: "00 Sample Street", landmark: "", consent: true, ...over });
  const stock = async (id) => one(`select stock, held from shop.variants where id = $1`, [id]);

  console.log("-- placing an order");
  let r = await site("web_place_order", [{ ...person(), items: [{ v: TEE_M, q: 1 }] }]);
  check("a closed shop takes no order", r.ok && r.rows[0].r.ok === false && r.rows[0].r.error === "closed", JSON.stringify(r));
  await c.query(`update shop.settings set shop_open = true`);
  r = await site("web_place_order", [{ ...person(), items: [{ v: TEE_M, q: 2 }, { v: HOOD_S, q: 1 }], price: 1, total: 1, delivery_fee: 0 }], true);
  const A = r.ok ? r.rows[0].r : {};
  check("the order is placed and numbered", A.ok === true && /^LAF-SHP-\d{4}-\d{5}$/.test(A.number ?? "") && /^[0-9a-f]{64}$/.test(A.token ?? ""), JSON.stringify(r).slice(0, 200));
  check("the database prices it: 2 x 450 + 1,250 = 2,150, whatever the browser sent", Number(A.subtotal) === 2150);
  check("delivery follows the weight: 1,000 g is the first Metro Manila line, 95", Number(A.delivery_fee) === 95 && Number(A.total) === 2245);
  check("the counted pieces are held, not yet sold", (await stock(TEE_M)).held === 2 && (await stock(TEE_M)).stock === 3);
  check("a made-to-order item is not held", (await stock(HOOD_S)).held === 0);
  check("the email is kept in small letters, and the trail starts", (await one(`select email, (select count(*) from shop.order_events e where e.order_id = o.id and e.event = 'placed') n from shop.orders o where number = $1`, [A.number])).email === "sample.customer@example.com");
  r = await site("web_place_order", [{ ...person({ email: "other@example.com", phone: "0918 000 0000" }), items: [{ v: TEE_M, q: 2 }] }]);
  check("a second buyer cannot take pieces that are held", r.ok && r.rows[0].r.error === "stock" && r.rows[0].r.items[0].left === 1, JSON.stringify(r).slice(0, 200));
  r = await site("web_place_order", [{ ...person({ email: "other@example.com", phone: "0918 000 0000" }), items: [{ v: TEE_L, q: 1 }] }]);
  check("an empty size cannot be ordered", r.ok && r.rows[0].r.error === "stock");
  r = await site("web_place_order", [{ ...person({ email: "other@example.com", phone: "0918 000 0000" }), items: [{ v: DRAFT_V, q: 1 }] }]);
  check("a draft product cannot be ordered", r.ok && r.rows[0].r.error === "gone");
  r = await site("web_place_order", [{ ...person({ email: "other@example.com", phone: "0918 000 0000" }), items: [{ v: "bbbbbbbb-0000-4000-8000-000000000000", q: 1 }] }]);
  check("an item that does not exist cannot be ordered", r.ok && r.rows[0].r.error === "gone");
  r = await site("web_place_order", [{ ...person({ email: "other@example.com", phone: "0918 000 0000", area: "Luzon" }), items: [{ v: HOOD_S, q: 2 }] }]);
  check("no fee line fits 1,200 g to Luzon, so the order is refused with the weight", r.ok && r.rows[0].r.error === "delivery" && r.rows[0].r.weight_grams === 1200, JSON.stringify(r).slice(0, 200));
  r = await site("web_place_order", [{ ...person({ email: "pick@example.com", phone: "0919 000 0000", delivery: "pickup", area: "", address_line: "" }), items: [{ v: HOOD_S, q: 1 }] }], true);
  const P = r.ok ? r.rows[0].r : {};
  check("pick-up is free and needs no address", P.ok === true && Number(P.delivery_fee) === 0 && Number(P.total) === 1250, JSON.stringify(r).slice(0, 200));
  for (const [name, bad] of [
    ["no items", { ...person(), items: [] }],
    ["21 pieces of one item", { ...person(), items: [{ v: HOOD_S, q: 21 }] }],
    ["the same item twice", { ...person(), items: [{ v: HOOD_S, q: 1 }, { v: HOOD_S, q: 1 }] }],
    ["a quantity that is not a number", { ...person(), items: [{ v: HOOD_S, q: "1; drop table shop.orders" }] }],
    ["no consent", { ...person({ consent: false }), items: [{ v: HOOD_S, q: 1 }] }],
    ["a bad email", { ...person({ email: "not-an-email" }), items: [{ v: HOOD_S, q: 1 }] }],
    ["an unknown area", { ...person({ area: "Abroad" }), items: [{ v: HOOD_S, q: 1 }] }],
    ["delivery without an address", { ...person({ address_line: "" }), items: [{ v: HOOD_S, q: 1 }] }],
  ]) {
    r = await site("web_place_order", [bad]);
    check(`refused: ${name}`, !r.ok && r.code === "22023", JSON.stringify(r).slice(0, 160));
  }
  // The same customer piles up unpaid orders.
  const mine = { ...person({ email: "many@example.com", phone: "0920 000 0000", delivery: "pickup", area: "", address_line: "" }), items: [{ v: HOOD_S, q: 1 }] };
  for (let i = 0; i < 3; i++) await site("web_place_order", [mine], true);
  r = await site("web_place_order", [mine]);
  check("a fourth unpaid order for the same customer is refused", r.ok && r.rows[0].r.error === "unpaid", JSON.stringify(r).slice(0, 160));

  console.log("-- the customer's private link");
  r = await site("web_order", [A.token]);
  const view = r.ok ? r.rows[0].r : null;
  check("the link shows the order and its items", view?.number === A.number && view?.status === "placed" && view?.items?.length === 2 && Number(view?.total) === 2245);
  check("it shows nothing internal (cost, the token, staff notes)", view && !JSON.stringify(view).includes("unit_cost") && !("token" in view) && !("attention" in view));
  r = await site("web_order", ["0".repeat(64)]);
  check("a wrong link shows nothing", r.ok && r.rows[0].r === null);
  r = await site("web_order", ["' or 1=1 --"]);
  check("a malformed link shows nothing", r.ok && r.rows[0].r === null);

  console.log("-- payment");
  r = await site("web_payment_paid", [A.number, "cs_test_A", "pay_test_A", 224500, "qrph", 3368, 221132]);
  check("a payment for a session the site never opened is refused", r.ok && r.rows[0].r.error === "session", JSON.stringify(r).slice(0, 160));
  r = await site("web_attach_payment", [A.token, "cs_test_A"], true);
  check("the site notes the payment session", r.ok && r.rows[0].r.ok === true, JSON.stringify(r).slice(0, 160));
  r = await site("web_payment_paid", [A.number, "cs_test_A", "pay_test_A", 100, "qrph", 1, 99], true);
  check("a payment of the wrong amount is refused and flagged for staff", r.ok && r.rows[0].r.error === "amount" && !!(await one(`select attention from shop.orders where number = $1`, [A.number])).attention, JSON.stringify(r).slice(0, 160));
  check("the order is still unpaid and the pieces still held", (await one(`select status from shop.orders where number = $1`, [A.number])).status === "placed" && (await stock(TEE_M)).held === 2);
  r = await site("web_payment_paid", [A.number, "cs_test_A", "pay_test_A", 224500, "qrph", 3368, 221132], true);
  check("the right payment marks the order paid", r.ok && r.rows[0].r.ok === true && r.rows[0].r.already === false, JSON.stringify(r).slice(0, 160));
  const paid = await one(`select status, pay_method, pay_fee, pay_net, attention, paid_at is not null as at from shop.orders where number = $1`, [A.number]);
  check("with the method, the fee and the net as the partner sent them", paid.status === "paid" && paid.pay_method === "qrph" && Number(paid.pay_fee) === 33.68 && Number(paid.pay_net) === 2211.32 && paid.at && paid.attention === null, JSON.stringify(paid));
  check("the held pieces leave the shelf: 3 becomes 1, nothing held", (await stock(TEE_M)).stock === 1 && (await stock(TEE_M)).held === 0, JSON.stringify(await stock(TEE_M)));
  check("the sale is on the stock trail, with the order number", (await one(`select count(*)::int n from shop.stock_moves where variant_id = $1 and reason = 'sold' and qty = -2 and stock_after = 1 and note = $2`, [TEE_M, A.number])).n === 1);
  r = await site("web_payment_paid", [A.number, "cs_test_A", "pay_test_A", 224500, "qrph", 3368, 221132], true);
  check("the same notice again changes nothing", r.ok && r.rows[0].r.ok === true && r.rows[0].r.already === true && (await stock(TEE_M)).stock === 1);
  r = await site("web_payment_paid", [A.number, "cs_test_A", "pay_test_OTHER", 224500, "qrph", 3368, 221132]);
  check("a second, different payment for a paid order is refused", r.ok && r.rows[0].r.ok === false && r.rows[0].r.error === "second payment");
  r = await site("web_attach_payment", [A.token, "cs_test_B"]);
  check("a paid order cannot open another payment", r.ok && r.rows[0].r.error === "status");

  console.log("-- an order that is not paid in time");
  r = await site("web_place_order", [{ ...person({ email: "late@example.com", phone: "0921 000 0000" }), items: [{ v: TEE_M, q: 1 }] }], true);
  const L = r.rows[0].r;
  await site("web_attach_payment", [L.token, "cs_test_L"], true);
  check("its piece is held", (await stock(TEE_M)).held === 1);
  await c.query(`update shop.orders set hold_until = now() - interval '1 minute' where number = $1`, [L.number]);
  r = await site("web_order", [L.token], true);
  check("after the hold ends the order shows as expired", r.ok && r.rows[0].r.status === "expired");
  check("and its piece is back on sale", (await stock(TEE_M)).held === 0 && (await stock(TEE_M)).stock === 1);
  r = await site("web_payment_paid", [L.number, "cs_test_L", "pay_test_L", Math.round(Number(L.total) * 100), "gcash", 1000, 53500], true);
  check("paid late while the piece is still there: accepted, the piece sold", r.ok && r.rows[0].r.ok === true && r.rows[0].r.attention === false && (await stock(TEE_M)).stock === 0, JSON.stringify(r).slice(0, 200));
  // Another late one, but now the shelf is empty.
  await c.query(`update shop.variants set stock = 1 where id = $1`, [TEE_M]);
  r = await site("web_place_order", [{ ...person({ email: "later@example.com", phone: "0922 000 0000" }), items: [{ v: TEE_M, q: 1 }] }], true);
  const G = r.rows[0].r;
  await site("web_attach_payment", [G.token, "cs_test_G"], true);
  await c.query(`update shop.orders set hold_until = now() - interval '1 minute' where number = $1`, [G.number]);
  await c.query(`select shop.release_expired()`);
  await c.query(`update shop.variants set stock = 0 where id = $1`, [TEE_M]);
  r = await site("web_payment_paid", [G.number, "cs_test_G", "pay_test_G", Math.round(Number(G.total) * 100), "card", 3000, 51500], true);
  const flagged = await one(`select status, attention from shop.orders where number = $1`, [G.number]);
  check("paid late with the piece gone: the money is recorded and staff are told", r.ok && r.rows[0].r.ok === true && r.rows[0].r.attention === true && flagged.status === "paid" && /no longer in stock/.test(flagged.attention ?? ""), JSON.stringify(flagged));
  check("and the empty shelf is not driven below zero", (await stock(TEE_M)).stock === 0);

  console.log("-- who may read orders");
  r = await run(ids.finance, `select number, email from shop.orders`);
  check("Finance reads the orders", r.ok && r.n >= 5);
  r = await run(ids.driver, `select 1 from shop.orders`);
  check("a driver reads none", r.ok && r.n === 0);
  r = await run(ids.finance, `update shop.orders set status = 'paid' where number = $1`, [P.number]);
  check("staff cannot mark an order paid by hand", !r.ok && r.code === "42501");
  r = await run(ids.admin, `delete from shop.orders`);
  check("nor delete orders", !r.ok && r.code === "42501");
  r = await run(ids.finance, `select shop.web_payment_paid($1, 'cs_x_123456', 'pay_x_123456', 125000, 'card', 0, 0)`, [P.number]);
  check("staff cannot run the site's payment step", !r.ok && r.code === "42501");
  r = await run("shop_web", `select 1 from shop.orders`);
  check("the site cannot read the orders table", !r.ok && r.code === "42501");
  r = await run("shop_web", `select 1 from shop.order_items`);
  check("nor the order lines", !r.ok && r.code === "42501");
  r = await run("shop_web", `select shop.release_expired()`);
  check("nor run the housekeeping step directly", !r.ok && r.code === "42501");
  r = await run("anon", `select shop.web_order($1)`, [A.token]);
  check("a signed-out visitor to the API reads no order, even with the link", !r.ok && r.code === "42501");
  r = await run("anon", `select 1 from shop.orders`);
  check("and no table", !r.ok && r.code === "42501");
} catch (e) {
  fail++;
  console.log("STOPPED:", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
