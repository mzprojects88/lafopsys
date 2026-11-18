// The 0160 pre-flight (customer accounts for the shop site), on the development database and ALWAYS rolled back.
// It applies the migration in a transaction, then plays a customer's steps as the public site's login (shop_web)
// and the staff's steps as real staff members, and checks who may do and read what.
//   node --env-file=.env.local scripts/rls/shop-customers-matrix.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";
import { seedShopAccess } from "./shop-access-seed.mjs";

if (isProd() || !pgUrl().includes("kptftyuzrnummbcjakro")) throw new Error("dev only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
let pass = 0, fail = 0;
const check = (name, good, extra = "") => { if (good) pass++; else fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name}${good ? "" : `  ${extra}`}`); };
const h = (s) => createHash("sha256").update(s).digest("hex");

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
const call = (who, fn, args, keep = false) => run(who, `select shop.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a)), keep);
const site = (fn, args, keep = false) => call("shop_web", fn, args, keep);
const got = (r) => (r.ok ? r.rows[0].r : null);
const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];

try {
  await c.query("begin");
  await seedShopAccess(c);
  await c.query(readFileSync(new URL("../../supabase/migrations/0160_shop_customers.sql", import.meta.url), "utf8"));
  await c.query("grant shop_web to current_user");
  if (!(await one("select pg_has_role(current_user, 'shop_web', 'SET') as ok")).ok) throw new Error("cannot act as shop_web: its limits would not be tested");
  const ids = await one(`select
    (select id from shared.staff where role = 'admin' and active order by id limit 1) admin,
    (select id from shared.staff where role = 'finance' and active order by id limit 1) finance,
    (select id from shared.staff where role = 'driver' and active order by id limit 1) driver`);
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);

  // Our own shop for the run: no customers, one item to sell.
  // Gifts (0161) point at customers; where that table exists, this run starts without them too.
  await c.query("do $$ begin if to_regclass('shop.gifts') is not null then delete from shop.gifts; end if; end $$");
  await c.query("delete from shop.customer_events; delete from shop.customer_sessions; delete from shop.sign_in_codes; update shop.orders set customer_id = null; delete from shop.customers");
  const TEE = "bbbbbbbb-0000-4000-8000-000000000001", TEE_M = "bbbbbbbb-0000-4000-8000-000000000011";
  await c.query("delete from shop.delivery_fees");
  await c.query("insert into shop.delivery_fees (area, max_grams, fee) values ('Metro Manila', 3000, 95)");
  await c.query("insert into shop.products (id, slug, name, category, supply, weight_grams, status) values ($1, 'zz-acct-tee', 'Account Test Tee', 'Apparel', 'made', 200, 'published')", [TEE]);
  await c.query("insert into shop.variants (id, product_id, sku, colour, size, price, cost, stock) values ($1, $2, 'ZZ-ACCT-M', 'White', 'M', 450, 190, 0)", [TEE_M, TEE]);
  await c.query("update shop.settings set shop_open = true, hold_minutes = 60");
  const person = (over = {}) => ({ name: "Sample Customer", email: "Sample.Buyer@example.com", phone: "0917 000 0000", delivery: "courier", area: "Metro Manila", province: "Metro Manila", city: "Quezon City", barangay: "Sample", postal_code: "1100", address_line: "00 Sample Street", landmark: "", consent: true, items: [{ v: TEE_M, q: 1 }], ...over });
  const EMAIL = "sample.buyer@example.com", CALLER = h("caller-1");
  const signIn = async (email, code, session, caller = CALLER) => {
    const s = got(await site("web_sign_in_start", [email, h(code), caller], true));
    const f = got(await site("web_sign_in_finish", [email, h(code), h(session), "Check browser"], true));
    return { s, f };
  };

  console.log("-- who may run and read what");
  let r = await call("anon", "web_sign_in_start", [EMAIL, h("111111"), CALLER]);
  check("someone not signed in to anything cannot ask for a code through the database", !r.ok, JSON.stringify(r));
  r = await call(ids.admin, "web_sign_in_start", [EMAIL, h("111111"), CALLER]);
  check("a staff member cannot run the site's functions", !r.ok && r.code === "42501", JSON.stringify(r));
  for (const t of ["customers", "customer_sessions", "sign_in_codes", "customer_events"]) {
    r = await run("shop_web", `select count(*) from shop.${t}`);
    check(`the site's login cannot read ${t}`, !r.ok && r.code === "42501", JSON.stringify(r));
  }
  for (const [fn, args] of [["customer_step", [ids.admin, "block", {}]], ["customer_devices", [ids.admin]], ["session_customer", [h("x")]], ["customer_set_details", [ids.admin, {}]], ["customer_close", [ids.admin, null]]]) {
    r = await site(fn, args);
    check(`the site's login cannot run ${fn}`, !r.ok && r.code === "42501", JSON.stringify(r));
  }
  const open = (await c.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'shop' and has_function_privilege('shop_web', p.oid, 'execute') and p.proname !~ '^web_'`)).rows;
  check("every function the site's login may run is a storefront one (web_)", open.length === 0, JSON.stringify(open));

  console.log("-- asking for a code");
  r = await site("web_sign_in_start", ["not-an-email", h("111111"), CALLER]);
  check("a wrong address is refused", !r.ok && r.code === "22023", JSON.stringify(r));
  r = await site("web_sign_in_start", [" Sample.Buyer@Example.com ", h("111111"), CALLER], true);
  check("a code may be sent", got(r)?.send === true, JSON.stringify(r));
  let k = await one("select email, code_hash, used_at, round(extract(epoch from expires_at - created_at)) as secs from shop.sign_in_codes where email = $1 order by created_at desc limit 1", [EMAIL]);
  check("only the code's hash is kept, under the lower-case address, for 10 minutes", k.email === EMAIL && k.code_hash === h("111111") && Number(k.secs) === 600, JSON.stringify(k));
  check("the answer does not say whether an account exists", JSON.stringify(got(r)) === '{"send": true}' || JSON.stringify(got(r)) === '{"send":true}', JSON.stringify(got(r)));
  await site("web_sign_in_start", [EMAIL, h("222222"), CALLER], true);
  r = await site("web_sign_in_finish", [EMAIL, h("111111"), h("s-old"), "x"], true);
  check("an older code stops working when a new one is asked for", got(r)?.ok === false, JSON.stringify(r));
  check("that wrong try is counted", (await one("select attempts from shop.sign_in_codes where email = $1 and used_at is null", [EMAIL])).attempts === 1);

  console.log("-- signing in");
  await c.query("update shop.orders set customer_id = null");
  const guest = got(await site("web_place_order", [person()], true));
  check("fixture: an order placed without signing in", guest?.ok === true, JSON.stringify(guest));
  r = await site("web_sign_in_finish", [EMAIL, h("999999"), h("s-1"), "x"], true);
  check("a wrong code is refused and says how many tries are left", got(r)?.ok === false && got(r)?.error === "wrong" && got(r)?.left === 3, JSON.stringify(r));
  check("no account is made by a wrong code", Number((await one("select count(*) n from shop.customers")).n) === 0);
  r = await site("web_sign_in_finish", [EMAIL, h("222222"), h("s-1"), "Check browser"], true);
  check("the right code signs in and makes the account", got(r)?.ok === true && got(r)?.new === true, JSON.stringify(r));
  const A = await one("select * from shop.customers where email = $1", [EMAIL]);
  check("the account holds the address in lower case, active, with one sign-in", A?.status === "active" && A.sign_in_count === 1 && !!A.last_sign_in_at, JSON.stringify(A));
  check("its details start from the earlier order", A.name === "Sample Customer" && A.phone === "0917 000 0000" && A.city === "Quezon City" && A.address_line === "00 Sample Street", JSON.stringify(A));
  check("the earlier order joined the account", (await one("select customer_id from shop.orders where number = $1", [guest.number])).customer_id === A.id);
  const sess = await one("select token_hash, user_agent, round(extract(epoch from expires_at - created_at) / 86400) as days from shop.customer_sessions where customer_id = $1", [A.id]);
  check("the device is kept by the hash of its token, for 30 days", sess.token_hash === h("s-1") && Number(sess.days) === 30 && sess.user_agent === "Check browser", JSON.stringify(sess));
  const ev = (await c.query("select event, detail from shop.customer_events where customer_id = $1 order by at, event", [A.id])).rows;
  check("the trail says created, then signed in with one earlier order", ev.some((e) => e.event === "created") && ev.some((e) => e.event === "signed_in" && /1 earlier order/.test(e.detail ?? "")), JSON.stringify(ev));
  r = await site("web_sign_in_finish", [EMAIL, h("222222"), h("s-2"), "x"], true);
  check("a code works once", got(r)?.ok === false && got(r)?.error === "expired", JSON.stringify(r));

  await site("web_sign_in_start", [EMAIL, h("333333"), CALLER], true);
  for (let i = 0; i < 4; i++) await site("web_sign_in_finish", [EMAIL, h("000000"), h("s-x"), "x"], true);
  r = await site("web_sign_in_finish", [EMAIL, h("000000"), h("s-x"), "x"], true);
  check("the fifth wrong try ends the code", got(r)?.error === "expired", JSON.stringify(r));
  r = await site("web_sign_in_finish", [EMAIL, h("333333"), h("s-x"), "x"], true);
  check("after five wrong tries even the right code is refused", got(r)?.ok === false, JSON.stringify(r));
  await site("web_sign_in_start", [EMAIL, h("444444"), CALLER], true);
  await c.query("update shop.sign_in_codes set expires_at = now() - interval '1 second' where email = $1 and used_at is null", [EMAIL]);
  r = await site("web_sign_in_finish", [EMAIL, h("444444"), h("s-x"), "x"], true);
  check("a code older than 10 minutes is refused", got(r)?.error === "expired", JSON.stringify(r));

  console.log("-- the limits on codes");
  r = await site("web_sign_in_start", [EMAIL, h("555555"), CALLER], true);
  check("the fifth code within the hour is still sent", got(r)?.send === true, JSON.stringify(r));
  r = await site("web_sign_in_start", [EMAIL, h("666666"), CALLER], true);
  check("the sixth is not", got(r)?.send === false && got(r)?.why === "limit", JSON.stringify(r));
  const BUSY = h("caller-busy");
  for (let i = 0; i < 20; i++) await site("web_sign_in_start", [`other${i}@example.com`, h("111111"), BUSY], true);
  r = await site("web_sign_in_start", ["other-last@example.com", h("111111"), BUSY], true);
  check("one caller gets twenty codes an hour, for whatever addresses", got(r)?.send === false && got(r)?.why === "limit", JSON.stringify(r));

  console.log("-- the signed-in customer");
  r = await site("web_customer", [h("s-1")]);
  const me = got(r);
  check("the session gives the customer back, with their order count", me?.email === EMAIL && me?.orders === 1 && me?.open_orders === 1 && me?.name === "Sample Customer", JSON.stringify(r));
  check("an unknown or unreadable session gives nothing", got(await site("web_customer", [h("nobody")])) === null && got(await site("web_customer", ["not-a-hash"])) === null);
  const other = got(await site("web_place_order", [person({ email: "someone.else@example.com", phone: "0918 111 1111", name: "Another Buyer" })], true));
  const list = got(await site("web_customer_orders", [h("s-1")]));
  check("My orders lists their order, with its private link, status and pieces", Array.isArray(list) && list.length === 1 && list[0].number === guest.number && list[0].token === guest.token && list[0].status === "placed" && Number(list[0].pieces) === 1, JSON.stringify(list));
  check("and nobody else's", !JSON.stringify(list).includes(other.number));
  check("orders are not listed without a session", got(await site("web_customer_orders", [h("nobody")])) === null);

  r = await site("web_customer_save", [h("s-1"), { name: "Sample Renamed", phone: "0917 222 3333", area: "Luzon", province: "Laguna", city: "Calamba", barangay: "", postal_code: "4027", address_line: "11 New Street", landmark: "Near the plaza", email: "hijack@example.com" }], true);
  const A2 = await one("select * from shop.customers where id = $1", [A.id]);
  check("the customer saves their details", got(r) === true && A2.name === "Sample Renamed" && A2.area === "Luzon" && A2.address_line === "11 New Street" && A2.barangay === null, JSON.stringify(A2));
  check("saving details cannot change the sign-in address", A2.email === EMAIL);
  r = await site("web_customer_save", [h("s-1"), { name: "Sample Renamed", phone: "abc" }]);
  check("a wrong mobile number is refused", !r.ok && r.code === "22023", JSON.stringify(r));
  r = await site("web_customer_save", [h("nobody"), { name: "X Y" }]);
  check("nothing is saved without a session", got(r) === false, JSON.stringify(r));

  console.log("-- an order placed while signed in");
  const mine = got(await site("web_place_order", [person({ email: "gift.for@example.com", phone: "0919 333 4444", name: "Gift Receiver" })], true));
  r = await site("web_claim_order", [h("s-1"), mine.token], true);
  check("the order just placed joins the account, even under another contact address", got(r) === true && (await one("select customer_id from shop.orders where number = $1", [mine.number])).customer_id === A.id, JSON.stringify(r));
  check("it does not overwrite details the customer already gave", (await one("select name, address_line from shop.customers where id = $1", [A.id])).name === "Sample Renamed");
  r = await site("web_claim_order", [h("s-1"), mine.token], true);
  check("an order already in an account cannot be taken again", got(r) === false);
  await c.query("update shop.orders set placed_at = now() - interval '16 minutes' where number = $1", [other.number]);
  r = await site("web_claim_order", [h("s-1"), other.token], true);
  check("an older order cannot be taken with its link alone", got(r) === false && (await one("select customer_id from shop.orders where number = $1", [other.number])).customer_id === null, JSON.stringify(r));

  console.log("-- changing the sign-in address");
  r = await site("web_email_change_start", [h("s-1"), EMAIL, h("777777"), CALLER], true);
  check("the same address is not a change", got(r)?.send === false && got(r)?.why === "same", JSON.stringify(r));
  r = await site("web_email_change_start", [h("nobody"), "new.address@example.com", h("777777"), CALLER], true);
  check("it needs a session", got(r)?.send === false && got(r)?.why === "signed_out", JSON.stringify(r));
  await c.query("delete from shop.sign_in_codes where email = $1", [EMAIL]);
  r = await site("web_email_change_start", [h("s-1"), "New.Address@example.com", h("777777"), CALLER], true);
  check("a code goes to the new address", got(r)?.send === true, JSON.stringify(r));
  r = await site("web_sign_in_finish", ["new.address@example.com", h("777777"), h("s-thief"), "x"], true);
  check("that code cannot be used to sign in", got(r)?.ok === false && Number((await one("select count(*) n from shop.customers where email = 'new.address@example.com'")).n) === 0, JSON.stringify(r));
  r = await site("web_email_change_finish", [h("s-1"), "new.address@example.com", h("000000")], true);
  check("a wrong code does not change it", got(r)?.ok === false && got(r)?.error === "wrong", JSON.stringify(r));
  r = await site("web_email_change_finish", [h("s-1"), "new.address@example.com", h("777777")], true);
  const A3 = await one("select email from shop.customers where id = $1", [A.id]);
  check("the right code changes the sign-in address", got(r)?.ok === true && A3.email === "new.address@example.com", JSON.stringify(r));
  check("the trail records the change and the old address", !!(await one("select 1 as x from shop.customer_events where customer_id = $1 and event = 'email_changed' and detail like '%sample.buyer@example.com%'", [A.id])));
  const B = await signIn("second.person@example.com", "121212", "s-b", h("caller-b"));
  check("fixture: a second customer", B.f?.ok === true, JSON.stringify(B));
  await site("web_email_change_start", [h("s-b"), "new.address@example.com", h("343434"), h("caller-b")], true);
  r = await site("web_email_change_finish", [h("s-b"), "new.address@example.com", h("343434")], true);
  check("an address that already has an account cannot be taken", got(r)?.ok === false && got(r)?.error === "taken", JSON.stringify(r));

  console.log("-- signing out");
  await c.query("delete from shop.sign_in_codes");
  const more = await signIn("new.address@example.com", "565656", "s-2");
  check("fixture: a second device", more.f?.ok === true && more.f?.new === false, JSON.stringify(more));
  r = await site("web_sign_out", [h("s-2"), false], true);
  check("signing out ends that device only", got(r) === true && got(await site("web_customer", [h("s-2")])) === null && got(await site("web_customer", [h("s-1")]))?.email === "new.address@example.com", JSON.stringify(r));
  await c.query("update shop.customer_sessions set expires_at = now() - interval '1 second' where token_hash = $1", [h("s-1")]);
  check("a session past its 30 days gives nothing", got(await site("web_customer", [h("s-1")])) === null);
  await c.query("update shop.customer_sessions set expires_at = now() + interval '30 days' where token_hash = $1", [h("s-1")]);
  for (let i = 0; i < 11; i++) {
    await c.query("delete from shop.sign_in_codes");
    await signIn("new.address@example.com", "787878", `s-many-${i}`);
  }
  check("a customer keeps ten devices at most", Number((await one("select count(*) n from shop.customer_sessions where customer_id = $1", [A.id])).n) === 10);
  r = await site("web_sign_out", [h("s-many-10"), true], true);
  check("signing out everywhere ends them all", got(r) === true && Number((await one("select count(*) n from shop.customer_sessions where customer_id = $1", [A.id])).n) === 0, JSON.stringify(r));

  console.log("-- the people who run the shop");
  await c.query("delete from shop.sign_in_codes");
  await signIn("new.address@example.com", "909090", "s-3");
  r = await run(ids.finance, "select email, name, status, sign_in_count from shop.customers where id = $1", [A.id]);
  check("a Shop viewer reads the customer", r.ok && r.rows[0]?.email === "new.address@example.com", JSON.stringify(r));
  r = await run(ids.driver, "select count(*)::int n from shop.customers");
  check("someone without the Shop reads no customer", r.ok && r.rows[0].n === 0, JSON.stringify(r));
  r = await run("anon", "select count(*) from shop.customers");
  check("nobody signed out reads customers", !r.ok, JSON.stringify(r));
  for (const t of ["customer_sessions", "sign_in_codes"]) {
    r = await run(ids.admin, `select count(*) from shop.${t}`);
    check(`not even an administrator reads ${t}`, !r.ok && r.code === "42501", JSON.stringify(r));
  }
  r = await run(ids.admin, "update shop.customers set email = 'staff.changed@example.com' where id = $1", [A.id]);
  check("staff cannot write a customer from the browser", !r.ok && r.code === "42501", JSON.stringify(r));
  r = await call(ids.finance, "customer_devices", [A.id]);
  check("a viewer sees how many devices are signed in", got(r) === 1, JSON.stringify(r));
  r = await call(ids.driver, "customer_devices", [A.id]);
  check("someone without the Shop does not", !r.ok && r.code === "42501", JSON.stringify(r));
  r = await call(ids.finance, "customer_step", [A.id, "block", { note: "test" }]);
  check("a viewer cannot block a customer", !r.ok && r.code === "42501", JSON.stringify(r));
  r = await call(ids.driver, "customer_step", [A.id, "block", {}]);
  check("nor can someone without the Shop", !r.ok && r.code === "42501", JSON.stringify(r));
  r = await call(ids.admin, "customer_step", [A.id, "edit", { name: "Fixed By Staff", phone: "0917 555 6666", area: "Luzon", province: "Laguna", city: "Calamba", address_line: "11 New Street", email: "staff.hijack@example.com" }], true);
  const A4 = await one("select name, phone, email from shop.customers where id = $1", [A.id]);
  check("an editor corrects name, mobile number and address", got(r) === "active" && A4.name === "Fixed By Staff" && A4.phone === "0917 555 6666", JSON.stringify(r));
  check("but never the sign-in address", A4.email === "new.address@example.com");
  check("the trail names the staff member", (await one("select by_staff_id from shop.customer_events where customer_id = $1 and event = 'details_changed' and by_staff_id is not null", [A.id]))?.by_staff_id === ids.admin);
  r = await call(ids.admin, "customer_step", [A.id, "sign_out", {}], true);
  check("an editor signs the customer out of every device", r.ok && got(await site("web_customer", [h("s-3")])) === null, JSON.stringify(r));
  await c.query("delete from shop.sign_in_codes");
  await signIn("new.address@example.com", "232323", "s-4");
  r = await call(ids.admin, "customer_step", [A.id, "block", { note: "Asked by the customer" }], true);
  check("an editor blocks the account, which signs it out", got(r) === "blocked" && got(await site("web_customer", [h("s-4")])) === null, JSON.stringify(r));
  await c.query("delete from shop.sign_in_codes");
  r = await site("web_sign_in_start", ["new.address@example.com", h("454545"), CALLER], true);
  check("a blocked account gets no code", got(r)?.send === false && got(r)?.why === "blocked", JSON.stringify(r));
  r = await call(ids.admin, "customer_step", [A.id, "block", {}]);
  check("a blocked account cannot be blocked twice", !r.ok && r.code === "23514", JSON.stringify(r));
  r = await call(ids.admin, "customer_step", [A.id, "unblock", {}], true);
  check("an editor unblocks it", got(r) === "active", JSON.stringify(r));
  r = await call(ids.admin, "customer_step", [A.id, "delete", {}]);
  check("an unknown step is refused", !r.ok && r.code === "22023", JSON.stringify(r));

  console.log("-- closing an account");
  const ordersBefore = Number((await one("select count(*) n from shop.orders where customer_id = $1", [A.id])).n);
  r = await call(ids.admin, "customer_step", [A.id, "close", {}], true);
  const closed = await one("select * from shop.customers where id = $1", [A.id]);
  check("closing removes the details and frees the address", got(r) === "closed" && closed.status === "closed" && /^closed-.*@closed\.invalid$/.test(closed.email) && closed.name === null && closed.phone === null && closed.address_line === null, JSON.stringify(closed));
  check("the orders stay, tied to the closed account", ordersBefore === 2 && Number((await one("select count(*) n from shop.orders where customer_id = $1", [A.id])).n) === 2);
  check("the orders themselves keep what the books need", (await one("select name, email from shop.orders where number = $1", [guest.number])).email.toLowerCase() === EMAIL);
  r = await call(ids.admin, "customer_step", [A.id, "unblock", {}]);
  check("a closed account takes no further step", !r.ok && r.code === "23514", JSON.stringify(r));
  await c.query("delete from shop.sign_in_codes");
  const again = await signIn("new.address@example.com", "676767", "s-5");
  const fresh = await one("select id, name from shop.customers where email = 'new.address@example.com'");
  check("the same address can open a new, empty account", again.f?.ok === true && again.f?.new === true && fresh.id !== A.id, JSON.stringify(again));
  check("which does not get the closed account's orders", got(await site("web_customer", [h("s-5")]))?.orders === 0);
  r = await site("web_customer_close", [h("s-b")], true);
  const bClosed = await one("select status, name from shop.customers where email like 'closed-%' and id <> $1", [A.id]);
  check("a customer closes their own account", got(r) === true && bClosed?.status === "closed" && got(await site("web_customer", [h("s-b")])) === null, JSON.stringify(r));
} catch (e) {
  fail++;
  console.error("ERROR", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`\n${pass} pass, ${fail} fail (rolled back)`);
process.exit(fail ? 1 : 0);
