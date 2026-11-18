// The 0157 pre-flight (staff steps on an order, the order emails, the policy texts, posting proceeds), on the
// development database and ALWAYS rolled back, the cash book entry included (ops is shared with production).
//   node --env-file=.env.local scripts/rls/shop-fulfilment-matrix.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";
import { seedShopAccess } from "./shop-access-seed.mjs";

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
const site = (fn, args, keep = true) => run("shop_web", `select shop.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a)), keep);
const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];
const step = (who, order, name, data = {}, keep = true) => run(who, `select shop.order_step($1, $2, $3::jsonb) as r`, [order, name, JSON.stringify(data)], keep);
const refused = (r, code) => !r.ok && r.code === code;
const brief = (r) => JSON.stringify(r).slice(0, 220);

try {
  await c.query("begin");
  await seedShopAccess(c);
  await c.query(readFileSync(new URL("../../supabase/migrations/0157_shop_fulfilment.sql", import.meta.url), "utf8"));
  await c.query("grant shop_web to current_user");
  if (!(await one("select pg_has_role(current_user, 'shop_web', 'SET') as ok")).ok) throw new Error("cannot act as shop_web: its limits would not be tested");
  const ids = await one(`select
    (select id from shared.staff where role = 'admin' and active order by id limit 1) admin,
    (select id from shared.staff where role = 'finance' and active order by id limit 1) finance,
    (select id from shared.staff where role = 'driver' and active order by id limit 1) driver,
    (select id from shared.staff where active and role not in ('admin', 'finance', 'driver', 'partner_viewer') order by id limit 1) shop`);
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);
  // Another account stands in for Shop Admin (rolled back with everything else).
  await c.query(`update shared.staff set role = 'shop_admin', extra_roles = '{}' where id = $1`, [ids.shop]);

  // A catalogue of our own: a counted tee (10 pieces) and a made-to-order hoodie.
  const TEE = "aaaaaaaa-0000-4000-8000-000000000001", TEE_M = "aaaaaaaa-0000-4000-8000-000000000011";
  const HOOD = "aaaaaaaa-0000-4000-8000-000000000002", HOOD_S = "aaaaaaaa-0000-4000-8000-000000000021";
  await c.query(`delete from shop.delivery_fees`);
  await c.query(`insert into shop.delivery_fees (area, max_grams, fee) values ('Metro Manila', 3000, 95)`);
  await c.query(`insert into shop.products (id, slug, name, category, supply, weight_grams, status) values ($1, 'zz-test-tee', 'Test Tee', 'Apparel', 'stock', 200, 'published'), ($2, 'zz-test-hoodie', 'Test Hoodie', 'Apparel', 'made', 600, 'published')`, [TEE, HOOD]);
  await c.query(`insert into shop.variants (id, product_id, sku, colour, size, price, cost, stock) values ($1, $3, 'ZZ-TEE-M', 'White', 'M', 450, 190, 10), ($2, $4, 'ZZ-HOOD-S', null, 'S', 1250, 600, 0)`, [TEE_M, HOOD_S, TEE, HOOD]);
  await c.query(`update shop.settings set shop_open = true, pickup_enabled = true, pickup_address = 'Sample pick-up <address>', pickup_note = 'Weekdays', hold_minutes = 60, cash_posting = false, site_url = 'https://shop.example.org'`);
  await c.query(`delete from shop.outbox`);
  // Orders already on development (from browser checks) would join this run's own in the day totals: none are
  // kept for the run. Like everything here, this is rolled back.
  await c.query(`delete from shop.order_events; delete from shop.order_items; delete from shop.orders`);
  const stock = async () => one(`select stock, held from shop.variants where id = $1`, [TEE_M]);
  let n = 0;
  /** Places an order as the site and returns it; `pay` also records its payment (fee 30.00). */
  async function order(items, { pickup = false, pay = true, name = "Sample Customer" } = {}) {
    n++;
    const p = { name, email: `sample${n}@example.com`, phone: `0917 000 00${String(n).padStart(2, "0")}`, delivery: pickup ? "pickup" : "courier", area: pickup ? "" : "Metro Manila", province: "Metro Manila", city: "Quezon City", barangay: "Roxas", postal_code: "1103", address_line: pickup ? "" : "00 Sample Street", landmark: "", consent: true, items };
    const r = await site("web_place_order", [p]);
    const o = r.ok ? r.rows[0].r : {};
    if (!o.ok) throw new Error(`fixture order was not placed: ${brief(r)}`);
    if (pay) {
      const cents = Math.round(Number(o.total) * 100);
      await site("web_attach_payment", [o.token, `cs_test_${n}`]);
      const paid = await site("web_payment_paid", [o.number, `cs_test_${n}`, `pay_test_${n}`, cents, "qrph", 3000, cents - 3000]);
      if (!paid.ok || paid.rows[0].r.ok !== true) throw new Error(`fixture order was not paid: ${brief(paid)}`);
    }
    return { ...o, id: (await one(`select id from shop.orders where number = $1`, [o.number])).id };
  }
  const row = (id) => one(`select status, courier, tracking_number, tracking_url, invoice_number, attention, refund_reason, restocked, posted_source_id, packed_at is not null packed, shipped_at is not null shipped, delivered_at is not null delivered, closed_at is not null closed from shop.orders where id = $1`, [id]);
  const mail = (id, kind) => one(`select count(*)::int n, max(body_html) body, max(subject) subject, max(to_address) to_address from shop.outbox where source = $2 and body_html like '%' || (select token from shop.orders where id = $1) || '%'`, [id, `shop:${kind}`]);

  console.log("-- a paid order tells the customer");
  const A = await order([{ v: TEE_M, q: 2 }, { v: HOOD_S, q: 1 }], { name: "Sam <b>Ple</b> & Co" });
  let m = await mail(A.id, "paid");
  check("the customer is emailed once when the payment arrives", m.n === 1 && m.to_address === "sample1@example.com" && m.subject.includes(A.number), brief(m));
  check("the email links to the order's private page on the shop's own address", m.body.includes(`https://shop.example.org/order/${A.token}`));
  check("what the customer typed cannot become markup in the email", m.body.includes("Sam &lt;b&gt;Ple&lt;/b&gt; &amp; Co") && !m.body.includes("<b>Ple</b>"), m.body.slice(0, 200));
  check("the total is written in pesos", m.body.includes("PHP 2,245.00"), m.body.slice(200, 420));

  console.log("-- who may work on orders");
  let r = await step(ids.driver, A.id, "pack", {}, false);
  check("someone without the Shop cannot pack an order", refused(r, "42501"), brief(r));
  r = await step(ids.finance, A.id, "pack", {}, false);
  check("Finance reads the Shop but cannot pack", refused(r, "42501"), brief(r));
  r = await step("anon", A.id, "pack", {}, false);
  check("a signed-out visitor cannot call the staff step", refused(r, "42501"));
  r = await step("shop_web", A.id, "deliver", {}, false);
  check("nor can the public site", refused(r, "42501"));
  r = await run(ids.shop, `update shop.orders set status = 'delivered' where id = $1`, [A.id]);
  check("Shop Admin cannot change an order behind the steps", refused(r, "42501"), brief(r));
  r = await run(ids.shop, `insert into shop.outbox (to_address, subject, body_html) values ('x@example.com', 'x', 'x')`);
  check("nor write an email into the outbox", refused(r, "42501"), brief(r));
  r = await run(ids.shop, `select count(*)::int n from shop.outbox`);
  check("Shop Admin can see what was emailed", r.ok && r.rows[0].n >= 1);
  r = await run(ids.driver, `select count(*)::int n from shop.outbox`);
  check("someone without the Shop sees none of it", r.ok && r.rows[0].n === 0, brief(r));
  r = await run("shop_web", `select 1 from shop.outbox`);
  check("the public site cannot read the outbox", refused(r, "42501"));

  console.log("-- delivery: pack, ship, deliver");
  r = await step(ids.shop, A.id, "ship", { courier: "LBC", tracking_number: "123" }, false);
  check("an order is packed before it is shipped", refused(r, "23514"), brief(r));
  r = await step(ids.shop, A.id, "pack");
  check("Shop Admin pack a paid order", r.ok && r.rows[0].r === "packed" && (await row(A.id)).packed, brief(r));
  r = await step(ids.shop, A.id, "pack", {}, false);
  check("it cannot be packed twice", refused(r, "23514"));
  r = await step(ids.shop, A.id, "ready", {}, false);
  check("a delivery order is not marked ready for pick-up", refused(r, "23514"));
  r = await step(ids.shop, A.id, "ship", { tracking_number: "123" }, false);
  check("shipping needs the courier", refused(r, "22023"));
  r = await step(ids.shop, A.id, "ship", { courier: "LBC" }, false);
  check("and the tracking number", refused(r, "22023"));
  r = await step(ids.shop, A.id, "ship", { courier: "LBC", tracking_number: "123", tracking_url: "javascript:alert(1)" }, false);
  check("a tracking link must be an https address", refused(r, "22023"));
  r = await step(ids.shop, A.id, "ship", { courier: " LBC ", tracking_number: " 1234567890 ", tracking_url: "https://track.example.org/?n=1234567890&x=<1>" });
  let a = await row(A.id);
  check("shipping records the courier and the number, trimmed", r.ok && a.status === "shipped" && a.courier === "LBC" && a.tracking_number === "1234567890" && a.shipped, brief(a));
  m = await mail(A.id, "shipped");
  check("the customer is told, with the courier, the number and a safe link", m.n === 1 && m.body.includes("LBC") && m.body.includes("1234567890") && m.body.includes("n=1234567890&amp;x=&lt;1&gt;"), (m.body ?? "").slice(0, 400));
  r = await run("shop_web", `select shop.web_order($1) as r`, [A.token]);
  check("the customer's order page gets the courier, the number and the tracking link", r.ok && r.rows[0].r.status === "shipped" && r.rows[0].r.courier === "LBC" && r.rows[0].r.tracking_url === "https://track.example.org/?n=1234567890&x=<1>", brief(r));
  r = await step(ids.shop, A.id, "invoice", { invoice_number: "" }, false);
  check("an invoice number cannot be blank", refused(r, "22023"));
  r = await step(ids.shop, A.id, "invoice", { invoice_number: " 000123 " });
  check("the sales invoice number is recorded", r.ok && (await row(A.id)).invoice_number === "000123");
  r = await step(ids.shop, A.id, "deliver");
  a = await row(A.id);
  check("a shipped order is marked delivered and closed", r.ok && a.status === "delivered" && a.delivered && a.closed);
  check("and the customer is told", (await mail(A.id, "delivered")).n === 1);
  r = await step(ids.shop, A.id, "cancel", {}, false);
  check("a paid order is never cancelled", refused(r, "23514"));
  const ev = await one(`select count(*)::int n, count(*) filter (where by_staff_id = $2)::int mine from shop.order_events where order_id = $1 and event in ('packed', 'shipped', 'invoice recorded', 'delivered')`, [A.id, ids.shop]);
  check("every step is on the order's trail with who did it", ev.n === 4 && ev.mine === 4, brief(ev));

  // An address the outbox would refuse (it cannot happen through the site, which checks it): the step still stands.
  const X = await order([{ v: HOOD_S, q: 1 }], { pickup: true });
  await c.query(`update shop.orders set email = 'not an email' where id = $1`, [X.id]);
  r = await step(ids.shop, X.id, "pack");
  r = await step(ids.shop, X.id, "ready");
  check("an email that cannot be queued never undoes the step", r.ok && (await row(X.id)).status === "ready" && (await one(`select count(*)::int n from shop.outbox where to_address = 'not an email'`)).n === 0, brief(r));

  console.log("-- pick-up: pack, ready, picked up");
  const B = await order([{ v: HOOD_S, q: 1 }], { pickup: true });
  await step(ids.shop, B.id, "pack");
  r = await step(ids.shop, B.id, "ship", { courier: "LBC", tracking_number: "1" }, false);
  check("a pick-up order is not shipped", refused(r, "23514"));
  r = await step(ids.shop, B.id, "deliver", {}, false);
  check("nor handed over before it is marked ready", refused(r, "23514"));
  r = await step(ids.shop, B.id, "ready");
  m = await mail(B.id, "ready");
  check("ready for pick-up: the customer is told where and when", r.ok && r.rows[0].r === "ready" && m.n === 1 && m.body.includes("Sample pick-up &lt;address&gt;") && m.body.includes("Weekdays"), (m.body ?? "").slice(0, 300));
  r = await step(ids.admin, B.id, "deliver");
  check("the Super Admin can mark it picked up", r.ok && (await row(B.id)).status === "delivered" && (await mail(B.id, "delivered")).body.includes("picked up"));

  console.log("-- an unpaid order");
  const C = await order([{ v: TEE_M, q: 3 }], { pay: false });
  check("its pieces are held", (await stock()).held === 3, brief(await stock()));
  check("no email goes out for an order that is only placed", (await one(`select count(*)::int n from shop.outbox where to_address = $1`, [C.email])).n === 0 && /@example.com$/.test(C.email));
  r = await step(ids.shop, C.id, "pack", {}, false);
  check("an unpaid order cannot be packed", refused(r, "23514"));
  r = await step(ids.shop, C.id, "invoice", { invoice_number: "1" }, false);
  check("or given an invoice", refused(r, "23514"));
  r = await step(ids.shop, C.id, "refund", { reason: "Customer asked" }, false);
  check("or refunded", refused(r, "23514"));
  r = await step(ids.shop, C.id, "cancel", { reason: "Customer asked" });
  check("cancelling it puts the held pieces back on sale", r.ok && (await row(C.id)).status === "cancelled" && (await stock()).held === 0 && (await stock()).stock === 8, brief(await stock()));
  check("and tells the customer nothing was charged", (await mail(C.id, "cancelled")).body.includes("Nothing was charged"));

  console.log("-- refunds");
  const D = await order([{ v: TEE_M, q: 2 }]);
  check("(a paid order took 2 pieces: 8 becomes 6)", (await stock()).stock === 6);
  r = await step(ids.shop, D.id, "refund", {}, false);
  check("a refund needs its reason", refused(r, "22023"));
  r = await step(ids.shop, D.id, "refund", { reason: "Wrong size sent back", restock: true });
  a = await row(D.id);
  check("refunded with the pieces returned: they are back in stock", r.ok && a.status === "refunded" && a.restocked === true && a.refund_reason === "Wrong size sent back" && (await stock()).stock === 8, brief(a));
  check("with a line on the stock trail", (await one(`select count(*)::int n from shop.stock_moves where variant_id = $1 and reason = 'returned' and qty = 2 and stock_after = 8 and note = $2 and by_staff_id = $3`, [TEE_M, D.number, ids.shop])).n === 1);
  check("and the customer is told the money goes back", (await mail(D.id, "refunded")).n === 1);
  r = await step(ids.shop, D.id, "refund", { reason: "Again please" }, false);
  check("an order is refunded once", refused(r, "23514"));
  const E = await order([{ v: TEE_M, q: 1 }]);
  r = await step(ids.shop, E.id, "refund", { reason: "Arrived damaged" });
  check("refunded without the pieces: stock stays as it was", r.ok && (await row(E.id)).restocked === false && (await stock()).stock === 7, brief(await stock()));

  // Paid after the hold ended, when the pieces had gone to someone else: nothing was taken from the shelf.
  const H = await order([{ v: TEE_M, q: 2 }], { pay: false });
  await site("web_attach_payment", [H.token, "cs_test_late"]);
  await c.query(`update shop.orders set status = 'expired', closed_at = now() where id = $1`, [H.id]);
  await c.query(`update shop.variants set held = 0, stock = 1 where id = $1`, [TEE_M]);
  r = await site("web_payment_paid", [H.number, "cs_test_late", "pay_test_late", 99500, "gcash", 2000, 97500]);
  check("(a late payment for pieces that are gone is recorded and flagged; the shelf is untouched)", r.ok && r.rows[0].r.ok === true && !!(await row(H.id)).attention && (await stock()).stock === 1, brief(r));
  r = await step(ids.shop, H.id, "refund", { reason: "Pieces sold to someone else", restock: true }, false);
  check("pieces that were never taken cannot be put back", refused(r, "23514") && /never taken/.test(r.error), brief(r));
  r = await step(ids.shop, H.id, "refund", { reason: "Pieces sold to someone else" });
  check("the late order is refunded, its flag cleared, the shelf still untouched", r.ok && (await row(H.id)).status === "refunded" && (await row(H.id)).attention === null && (await stock()).stock === 1);
  await c.query(`update shop.variants set stock = 7 where id = $1`, [TEE_M]);

  console.log("-- flags, and steps that do not exist");
  r = await step(ids.shop, A.id, "looked", { reason: "Checked it" }, false);
  check("nothing to clear when nothing is flagged", refused(r, "23514"));
  await c.query(`update shop.orders set attention = 'Payment arrived after the hold ended' where id = $1`, [A.id]);
  r = await step(ids.shop, A.id, "looked", {}, false);
  check("clearing a flag needs a word on what was done", refused(r, "22023"));
  r = await step(ids.shop, A.id, "looked", { reason: "Stock checked, order goes ahead" });
  check("a flag is cleared, and the note kept on the trail", r.ok && (await row(A.id)).attention === null && (await one(`select count(*)::int n from shop.order_events where order_id = $1 and event = 'flag cleared' and detail like 'Stock checked%'`, [A.id])).n === 1);
  r = await step(ids.shop, A.id, "teleport", {}, false);
  check("an unknown step is refused", refused(r, "22023"));
  r = await step(ids.shop, "bbbbbbbb-0000-4000-8000-000000000000", "pack", {}, false);
  check("as is an order that does not exist", refused(r, "P0002"));

  console.log("-- proceeds to the cash book");
  const F = await order([{ v: TEE_M, q: 1 }]);
  const G = await order([{ v: HOOD_S, q: 1 }], { pickup: true });
  // A and F were paid "yesterday", B and G "the day before"; D and E (refunded) too, to show they are left out.
  await c.query(`update shop.orders set paid_at = paid_at - interval '1 day' where id = any($1)`, [[A.id, F.id, D.id]]);
  await c.query(`update shop.orders set paid_at = paid_at - interval '2 days' where id = any($1)`, [[B.id, G.id, E.id]]);
  const day = async (back) => (await one(`select ((now() at time zone 'Asia/Manila')::date - $1::int)::text d`, [back])).d;
  const [today, yesterday, before] = [await day(0), await day(1), await day(2)];
  const post = (who, d, keep = true) => run(who, `select shop.post_proceeds($1::date) as r`, [d], keep);
  const entries = async () => (await one(`select count(*)::int n from ops.cash_entries where source_id like 'shop:%'`)).n;
  const had = await entries();
  r = await post(ids.shop, yesterday, false);
  check("Shop Admin cannot post to the cash book", refused(r, "42501"), brief(r));
  r = await post(ids.driver, yesterday, false);
  check("nor can someone outside Finance and the Shop", refused(r, "42501"));
  r = await post("shop_web", yesterday, false);
  check("nor the public site", refused(r, "42501"));
  r = await post(ids.admin, yesterday, false);
  check("posting is off until Shop settings switch it on", refused(r, "23514") && /switched off/.test(r.error), brief(r));
  await c.query(`update shop.settings set cash_posting = true`);
  r = await post(ids.admin, today, false);
  check("today cannot be posted: the day is not over", refused(r, "23514"));
  r = await post(ids.admin, await day(40));
  check("a day with no sales posts nothing", r.ok && r.rows[0].r.posted === 0 && (await entries()) === had, brief(r));
  r = await post(ids.admin, yesterday);
  const posted = r.ok ? r.rows[0].r : {};
  // A: 2,245.00 less the 30.00 fee = 2,215.00; F: 450 + 95 = 545.00 less 30.00 = 515.00. D was refunded: left out.
  check("yesterday's two paid orders post as one inflow of what reached the foundation", posted.posted === 2 && Number(posted.amount) === 2730 && Number(posted.sold) === 2790 && Number(posted.fees) === 60 && posted.source_id === `shop:${yesterday}`, brief(r));
  const entry = await one(`select direction, source, entity, currency, amount, date::text d, approval_status, description from ops.cash_entries where source_id = $1`, [`shop:${yesterday}`]);
  check("the cash book has it: an approved peso inflow dated that day", !!entry && entry.direction === "inflow" && entry.source === "shop_sales" && entry.entity === "PH_SEC" && entry.currency === "PHP" && Number(entry.amount) === 2730 && entry.d === yesterday && entry.approval_status === "approved", brief(entry));
  check("the description says how many orders, what was sold and the fees, and names no customer", /2 orders, sold 2,790\.00, payment fees 60\.00/.test(entry?.description ?? "") && !/Sam|Sample/.test(entry?.description ?? ""), entry?.description);
  check("the two orders are marked as posted; the refunded one is not", (await row(A.id)).posted_source_id === `shop:${yesterday}` && (await row(F.id)).posted_source_id === `shop:${yesterday}` && (await row(D.id)).posted_source_id === null);
  r = await post(ids.admin, yesterday, false);
  check("the same day cannot be posted twice", refused(r, "23505"), brief(r));
  const financeEdits = (await run(ids.finance, `select shared.module_editable('finance') as ok`)).rows?.[0]?.ok === true;
  r = await post(ids.finance, before);
  check("Finance (edits Finance, reads the Shop) posts a day", financeEdits ? r.ok && r.rows[0].r.posted === 2 && Number(r.rows[0].r.amount) === 2440 : refused(r, "42501"), `${financeEdits} ${brief(r)}`);
  r = await step(ids.shop, F.id, "refund", { reason: "Parcel lost by the courier" });
  check("an order already in the cash book can still be refunded, and the trail tells Finance", r.ok && (await row(F.id)).status === "refunded" && (await row(F.id)).posted_source_id === `shop:${yesterday}` && (await one(`select count(*)::int n from shop.order_events where order_id = $1 and event = 'refunded' and detail like '%already in the cash book%'`, [F.id])).n === 1);
  check("the cash book entry itself is left for Finance", Number((await one(`select amount from ops.cash_entries where source_id = $1`, [`shop:${yesterday}`])).amount) === 2730);

  console.log("-- settings, policy texts, pages, grants");
  r = await run("shop_web", `select shop.web_policies() as r`);
  check("the site reads the three policy texts", r.ok && ["terms", "privacy", "returns"].every((k) => (r.rows[0].r[k] ?? "").length > 200), brief(r));
  r = await run("anon", `select shop.web_policies()`);
  check("a signed-out visitor to the API does not", refused(r, "42501"));
  r = await run(ids.shop, `update shop.settings set couriers = array['LBC', 'Ninja Van'], site_url = 'https://shop.littlearkfoundation.org'`, [], true);
  check("Shop Admin keep the list of couriers", r.ok && r.n === 1, brief(r));
  r = await run(ids.shop, `update shop.settings set site_url = 'javascript:alert(1)'`);
  check("the site's address must be a web address", refused(r, "23514"), brief(r));
  r = await run(ids.finance, `update shop.settings set cash_posting = false`);
  check("Finance (read-only in the Shop) changes no Shop setting", r.ok && r.n === 0, brief(r));
  const pages = await one(`select count(*)::int n from shared.role_page_access where page in ('shop.orders', 'shop.proceeds')`);
  check("the two new pages are given to the Shop Admin, Finance and the CEO, and not to the Office Admin", pages.n === 6 && (await one(`select count(*)::int n from shared.role_page_access where page like 'shop.%' and role = 'office_admin'`)).n === 0, brief(pages));
  const priv = await one(`select
    has_function_privilege('anon', 'shop.order_step(uuid, text, jsonb)', 'execute') a, has_function_privilege('shop_web', 'shop.order_step(uuid, text, jsonb)', 'execute') b,
    has_function_privilege('anon', 'shop.post_proceeds(date)', 'execute') c, has_function_privilege('shop_web', 'shop.post_proceeds(date)', 'execute') d,
    has_function_privilege('authenticated', 'shop.queue_order_email()', 'execute') e, has_function_privilege('authenticated', 'shop.web_policies()', 'execute') f,
    has_function_privilege('shop_web', 'shop.web_policies()', 'execute') g, has_function_privilege('authenticated', 'shop.order_step(uuid, text, jsonb)', 'execute') h`);
  check("each new function is open only to who needs it", !priv.a && !priv.b && !priv.c && !priv.d && !priv.e && !priv.f && priv.g && priv.h, brief(priv));
} catch (e) {
  fail++;
  console.log("STOPPED:", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
