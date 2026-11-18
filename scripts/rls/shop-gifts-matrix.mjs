// The 0161 pre-flight (giving from a customer's account), on the development database and ALWAYS rolled back.
// It applies the migration in a transaction, plays a customer's gifts as the public site's login (shop_web), and
// checks what reaches Donors, what never does (test payments), and who may read and run what.
//   node --env-file=.env.local scripts/rls/shop-gifts-matrix.mjs
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
const num = async (sql, params = []) => Number((await one(sql, params)).n);

try {
  await c.query("begin");
  await seedShopAccess(c);
  for (const f of ["0160_shop_customers.sql", "0161_shop_gifts.sql"]) await c.query(readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8"));
  await c.query("grant shop_web to current_user");
  if (!(await one("select pg_has_role(current_user, 'shop_web', 'SET') as ok")).ok) throw new Error("cannot act as shop_web: its limits would not be tested");
  const ids = await one(`select
    (select id from shared.staff where role = 'admin' and active order by id limit 1) admin,
    (select id from shared.staff where role = 'finance' and active order by id limit 1) finance,
    (select id from shared.staff where role = 'driver' and active order by id limit 1) driver`);
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);

  // Our own shop for the run: no customers and no gifts.
  await c.query("delete from shop.gifts; delete from shop.customer_events; delete from shop.customer_sessions; delete from shop.sign_in_codes; update shop.orders set customer_id = null; delete from shop.customers");
  await c.query("update shop.settings set giving_open = true, gift_amounts = array[200, 500, 1000, 2500], gift_min = 100, gift_max = 50000");
  const CALLER = h("caller-1");
  const signIn = async (email, session) => {
    await site("web_sign_in_start", [email, h("111111"), CALLER], true);
    return got(await site("web_sign_in_finish", [email, h("111111"), h(session), "Check browser"], true));
  };
  await signIn("giver.one@example.com", "s-a");
  await signIn("giver.two@example.com", "s-b");
  await c.query("update shop.customers set name = 'Sample Giver', phone = '0917 000 0001' where email = 'giver.one@example.com'");
  const A = await one("select id from shop.customers where email = 'giver.one@example.com'");
  const B = await one("select id from shop.customers where email = 'giver.two@example.com'");
  const register = async () => ({ donors: await num("select count(*) n from ops.donors"), gifts: await num("select count(*) n from ops.donations"), receipts: await num("select count(*) n from ops.acknowledgment_receipts") });
  const counter = async () => Number((await one("select coalesce((select last from ops.doc_counters where prefix = 'LAF-CSH' and year = extract(year from now() at time zone 'Asia/Manila')::int), 0) n")).n);
  const before = await register();
  const counterBefore = await counter();
  // A gift from its start to its payment, as the site does it.
  const give = async (session, body, { live, method = "gcash", pay = true } = {}) => {
    const started = await site("web_gift_start", [h(session), body], true);
    if (!started.ok) console.log("   (a gift could not be started:", started.error, ")");
    const start = got(started);
    if (!start?.ok || !pay) return { start };
    const sid = `cs_test_${start.reference.slice(-5)}${Math.random().toString(36).slice(2, 8)}`;
    const attach = got(await site("web_gift_attach", [h(session), start.reference, sid], true));
    const paid = got(await site("web_gift_paid", [start.reference, sid, `pay_${sid}`, Math.round(Number(start.amount) * 100), method, Math.round(Number(start.amount) * 2.23), Math.round(Number(start.amount) * 97.77), live], true));
    return { start, attach, paid, sid, row: await one("select * from shop.gifts where reference = $1", [start.reference]) };
  };
  const donationOf = (gift) => one("select d.*, n.name donor_name, n.type donor_type, n.email donor_email, a.sequence_number, a.status ar_status, a.amount ar_amount, a.issued_by from ops.donations d join ops.donors n on n.id = d.donor_id left join ops.acknowledgment_receipts a on a.donation_id = d.id where d.source_id = 'shop-gift:' || $1", [gift.id]);

  console.log("-- who may run and read what");
  let r = await run("shop_web", "select count(*) from shop.gifts");
  check("the site's login cannot read the gifts table", !r.ok && r.code === "42501", JSON.stringify(r));
  for (const t of ["ops.donations", "ops.donors", "ops.acknowledgment_receipts", "shared.app_settings"]) {
    r = await run("shop_web", `select count(*) from ${t}`);
    check(`the site's login cannot read ${t}`, !r.ok && r.code === "42501", JSON.stringify(r));
  }
  for (const [fn, args] of [["gift_to_donors", [A.id]], ["gifts_sweep", []]]) {
    r = await site(fn, args);
    check(`the site's login cannot run ${fn}`, !r.ok && r.code === "42501", JSON.stringify(r));
    r = await call(ids.admin, fn, args);
    check(`a staff member cannot run ${fn}`, !r.ok && r.code === "42501", JSON.stringify(r));
  }
  r = await run("shop_web", "select ops.next_doc_number('LAF-CSH', 2026)");
  check("the site's login cannot take a receipt number", !r.ok && r.code === "42501", JSON.stringify(r));
  r = await call(ids.admin, "web_giving", [h("s-a")]);
  check("a staff member cannot run the site's functions", !r.ok && r.code === "42501", JSON.stringify(r));
  r = await call("anon", "web_gift_start", [h("s-a"), { amount: 500 }]);
  check("someone signed in to nothing cannot start a gift through the database", !r.ok, JSON.stringify(r));
  const open = (await c.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'shop' and has_function_privilege('shop_web', p.oid, 'execute') and p.proname !~ '^web_'`)).rows;
  check("every function the site's login may run is a storefront one (web_)", open.length === 0, JSON.stringify(open));

  console.log("-- the giving page");
  let page = got(await site("web_giving", [h("s-a")]));
  check("a signed-in customer gets the amounts from Shop settings", page?.open === true && page.amounts.join() === "200,500,1000,2500" && Number(page.min) === 100 && Number(page.max) === 50000 && page.name === "Sample Giver" && page.gifts.length === 0, JSON.stringify(page));
  check("without a session there is no giving page", got(await site("web_giving", [h("nobody")])) === null);

  console.log("-- starting a gift");
  r = await site("web_gift_start", [h("nobody"), { amount: 500 }]);
  check("not signed in: no gift", got(r)?.ok === false && got(r)?.error === "signed_out", JSON.stringify(r));
  for (const [what, body] of [["a gift below the smallest amount", { amount: 99.99 }], ["a gift above the largest amount", { amount: 50000.01 }], ["a gift with fractions of a centavo", { amount: 500.005 }]]) {
    r = await site("web_gift_start", [h("s-a"), body]);
    check(`${what} is refused, with the limits`, got(r)?.ok === false && got(r)?.error === "amount" && Number(got(r)?.min) === 100, JSON.stringify(r));
  }
  for (const [what, body] of [["an amount sent as text", { amount: "500" }], ["no amount", {}], ["something that is not a gift", [1]]]) {
    r = await site("web_gift_start", [h("s-a"), body]);
    check(`${what} is refused`, !r.ok && r.code === "22023", JSON.stringify(r));
  }
  r = await site("web_gift_start", [h("s-b"), { amount: 500 }]);
  check("a named gift needs a name when the account has none", got(r)?.ok === false && got(r)?.error === "name", JSON.stringify(r));
  for (const [what, name] of [["a control character", "Sample\u0007Giver"], ["a character that reverses the text", "Sample ‮reviG"], ["an invisible character", "Sam​ple Giver"], ["one letter", "S"]]) {
    r = await site("web_gift_start", [h("s-b"), { amount: 500, name }]);
    check(`a receipt name with ${what} is refused`, got(r)?.ok === false && got(r)?.error === "name", JSON.stringify(r));
  }
  check("and none of those tries left a gift or a name behind", (await num("select count(*) n from shop.gifts")) === 0 && (await one("select name from shop.customers where id = $1", [B.id])).name === null);
  await c.query("update shop.settings set giving_open = false");
  r = await site("web_gift_start", [h("s-a"), { amount: 500 }]);
  check("while giving is closed in Shop settings, no gift starts", got(r)?.ok === false && got(r)?.error === "closed", JSON.stringify(r));
  await c.query("update shop.settings set giving_open = true");

  console.log("-- a test payment never reaches Donors");
  const t = await give("s-a", { amount: 500 }, { live: false });
  check("a gift starts with its own reference and waits for payment", /^LAF-GFT-\d{4}-\d{5,}$/.test(t.start.reference) && Number(t.start.amount) === 500 && t.start.email === "giver.one@example.com" && t.start.name === "Sample Giver", JSON.stringify(t.start));
  check("the payment is recorded", t.attach?.ok === true && t.paid?.ok === true && t.row.status === "paid" && t.row.pay_method === "gcash" && Number(t.row.pay_fee) === 11.15 && Number(t.row.pay_net) === 488.85, JSON.stringify([t.paid, t.row]));
  check("a test payment is marked as one and takes no receipt number", t.row.live === false && t.row.receipt_no === null && (await counter()) === counterBefore, JSON.stringify(t.row));
  check("and nothing is written into Donors", JSON.stringify(await register()) === JSON.stringify(before), JSON.stringify(await register()));
  await c.query("select shop.gifts_sweep()");
  check("the ten-minute job leaves a test gift alone too", JSON.stringify(await register()) === JSON.stringify(before) && (await one("select receipt_no from shop.gifts where id = $1", [t.row.id])).receipt_no === null);
  page = got(await site("web_giving", [h("s-a")]));
  check("the customer sees it, marked as a test, outside the year's total", page.gifts.length === 1 && page.gifts[0].test === true && page.gifts[0].receipt_no === null && Number(page.given) === 0, JSON.stringify(page));
  check("no receipt can be had for it", got(await site("web_gift_receipt", [h("s-a"), t.start.reference])) === null);

  console.log("-- a live gift, with the name on the receipt");
  const g1 = await give("s-a", { amount: 500 }, { live: true });
  const d1 = await donationOf(g1.row);
  const year = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 4);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  check("the payment is recorded as a live one", g1.paid?.ok === true && g1.row.status === "paid" && g1.row.live === true && g1.row.attention === null, JSON.stringify([g1.paid, g1.row]));
  check("the gift is in Donors: cash, to the Philippine entity, today, the full amount", !!d1 && d1.kind === "cash" && d1.receiving_entity === "PH_SEC" && d1.currency === "PHP" && Number(d1.total_value) === 500 && d1.status === "finalized" && d1.payment_method === "online" && new Date(d1.date).toLocaleDateString("en-CA") === today, JSON.stringify(d1));
  check("its note says how it came and the reference, and nothing about the fee", d1?.notes === `Given through the Little Ark Shop (GCash). Reference ${g1.start.reference}.`, d1?.notes);
  check("a new donor was made from the customer: an individual, with the confirmed address", d1?.donor_name === "Sample Giver" && d1?.donor_type === "individual" && d1?.donor_email === "giver.one@example.com" && (await register()).donors === before.donors + 1, JSON.stringify([d1?.donor_type, await register()]));
  check("the receipt is numbered from the LAF-CSH series, once, and is issued", new RegExp(`^LAF-CSH-${year}-\\d{4}$`).test(d1?.sequence_number ?? "") && d1.ar_status === "issued" && Number(d1.ar_amount) === 500 && d1.issued_by === null && (await counter()) === counterBefore + 1, JSON.stringify([d1?.sequence_number, await counter(), counterBefore]));
  check("the gift carries its receipt number", g1.row.receipt_no === d1?.sequence_number && g1.row.posted_at !== null, JSON.stringify(g1.row));
  const totals = await one("select gift_count, lifetime_value from ops.donors where id = $1", [d1.donor_id]);
  check("the donor's totals follow", Number(totals.gift_count) === 1 && Number(totals.lifetime_value) === 500, JSON.stringify(totals));
  r = await site("web_gift_paid", [g1.start.reference, g1.sid, `pay_${g1.sid}`, 50000, "gcash", 1115, 48885, true], true);
  check("the same notice again changes nothing", got(r)?.ok === true && got(r)?.already === true && (await counter()) === counterBefore + 1 && (await register()).gifts === before.gifts + 1, JSON.stringify(r));
  r = await site("web_gift_paid", [g1.start.reference, g1.sid, "pay_another_one", 50000, "gcash", 1115, 48885, true], true);
  check("a second payment for one gift is refused", got(r)?.ok === false && got(r)?.error === "second payment", JSON.stringify(r));
  const rc = got(await site("web_gift_receipt", [h("s-a"), g1.start.reference]));
  check("the customer's receipt carries what ArkOS prints: number, date, donor, amount, how it was paid, the purpose", rc?.number === d1.sequence_number && rc?.donor === "Sample Giver" && Number(rc?.amount) === 500 && rc?.currency === "PHP" && rc?.method === "online" && rc?.date === today && typeof rc?.purpose === "string" && rc.purpose.length > 10 && typeof rc?.title === "string", JSON.stringify(rc));
  check("another customer cannot have that receipt", got(await site("web_gift_receipt", [h("s-b"), g1.start.reference])) === null);
  check("nor can anyone without a session", got(await site("web_gift_receipt", [h("nobody"), g1.start.reference])) === null);
  page = got(await site("web_giving", [h("s-a")]));
  check("the customer sees the gift with its receipt number, and the year's total", page.gifts[0].reference === g1.start.reference && page.gifts[0].receipt_no === d1.sequence_number && page.gifts[0].test === false && Number(page.given) === 500 && String(page.year) === year, JSON.stringify(page));
  check("the other customer sees none of it", got(await site("web_giving", [h("s-b")])).gifts.length === 0);

  console.log("-- the next gifts of the same customer");
  const g2 = await give("s-a", { amount: 1000 }, { live: true, method: "qrph" });
  const d2 = await donationOf(g2.row);
  check("a second gift joins the same donor and takes the next number", d2?.donor_id === d1.donor_id && (await register()).donors === before.donors + 1 && Number(d2.sequence_number.slice(-4)) === Number(d1.sequence_number.slice(-4)) + 1 && /\(QR Ph\)/.test(d2.notes), JSON.stringify([d2?.sequence_number, d2?.notes]));
  await c.query("update shop.customers set email = 'giver.moved@example.com' where id = $1", [A.id]);
  const g3 = await give("s-a", { amount: 200 }, { live: true, method: "card" });
  const d3 = await donationOf(g3.row);
  check("after the customer changes their address, their gifts still join the same donor", d3?.donor_id === d1.donor_id && (await register()).donors === before.donors + 1, JSON.stringify(d3?.donor_id));

  console.log("-- a donor already in the list, by the same email address");
  const known = await one("insert into ops.donors (name, type, email, tax_jurisdiction) values ('Sample Known Donor', 'individual', ' Giver.Two@Example.com ', 'PH') returning id");
  const g4 = await give("s-b", { amount: 2500, name: "  Sample   Second  " }, { live: true });
  const d4 = await donationOf(g4.row);
  check("the gift joins the donor with that address, however it was typed, and no new donor is made", d4?.donor_id === known.id && (await register()).donors === before.donors + 2, JSON.stringify([d4?.donor_id, known.id]));
  check("the name typed for the receipt is tidied and becomes the account's name", g4.row.receipt_name === "Sample Second" && (await one("select name from shop.customers where id = $1", [B.id])).name === "Sample Second", JSON.stringify(g4.row.receipt_name));
  check("the receipt names the donor as the donor list has them", got(await site("web_gift_receipt", [h("s-b"), g4.start.reference]))?.donor === "Sample Known Donor");

  console.log("-- an anonymous gift");
  const donorsBeforeAnon = (await register()).donors;
  const anonBefore = await num("select count(*) n from ops.donors where type = 'anonymous'");
  const g5 = await give("s-a", { amount: 300, anonymous: true, name: "Should Not Be Kept" }, { live: true });
  const d5 = await donationOf(g5.row);
  check("the gift keeps no name", g5.row.anonymous === true && g5.row.receipt_name === null, JSON.stringify(g5.row));
  check("it goes under the anonymous donor, and no donor is made for the customer", d5?.donor_type === "anonymous" && (await register()).donors === donorsBeforeAnon + (anonBefore === 0 ? 1 : 0), JSON.stringify([d5?.donor_type, anonBefore]));
  check("it is receipted all the same", /^LAF-CSH-/.test(d5?.sequence_number ?? "") && g5.row.receipt_no === d5.sequence_number, JSON.stringify(d5?.sequence_number));
  const rc5 = got(await site("web_gift_receipt", [h("s-a"), g5.start.reference]));
  check("its receipt does not name the customer", !!rc5 && /^anonymous/i.test(rc5.donor) && !JSON.stringify(rc5).includes("Sample Giver") && !JSON.stringify(rc5).includes("giver."), JSON.stringify(rc5));
  check("the named donor's totals do not include it", Number((await one("select lifetime_value from ops.donors where id = $1", [d1.donor_id])).lifetime_value) === 1700);
  const g6 = await give("s-a", { amount: 400 }, { live: true });
  check("a named gift after an anonymous one still joins the customer's own donor", (await donationOf(g6.row))?.donor_id === d1.donor_id);

  console.log("-- what cannot go wrong with a payment");
  const w = await give("s-b", { amount: 500 }, { pay: false });
  r = await site("web_gift_attach", [h("s-a"), w.start.reference, "cs_test_someone_else"], true);
  check("another customer cannot attach a payment session to the gift", got(r)?.ok === false, JSON.stringify(r));
  await site("web_gift_attach", [h("s-b"), w.start.reference, "cs_test_wrong_amount"], true);
  r = await site("web_gift_paid", [w.start.reference, "cs_test_other_session", "pay_test_other_1", 50000, "gcash", 0, 50000, true], true);
  check("a notice naming another payment session is refused", got(r)?.ok === false && got(r)?.error === "session", JSON.stringify(r));
  r = await site("web_gift_paid", [w.start.reference, "cs_test_wrong_amount", "pay_test_wrong_1", 49900, "gcash", 0, 49900, true], true);
  const wrong = await one("select status, attention from shop.gifts where reference = $1", [w.start.reference]);
  check("a payment of another amount is refused and flagged for staff", got(r)?.ok === false && got(r)?.error === "amount" && wrong.status === "pending" && /499\.00/.test(wrong.attention ?? ""), JSON.stringify([r, wrong]));
  r = await site("web_gift_paid", ["LAF-GFT-2026-99999", "cs_test_wrong_amount", "pay_test_none_1", 50000, "gcash", 0, 50000, true]);
  check("a payment for a gift that does not exist is refused", got(r)?.ok === false && got(r)?.error === "unknown", JSON.stringify(r));
  await c.query("update shop.gifts set created_at = now() - interval '2 days' where reference = $1", [w.start.reference]);
  await c.query("select shop.gifts_sweep()");
  check("a gift nobody paid within a day is let go", (await one("select status from shop.gifts where reference = $1", [w.start.reference])).status === "expired");
  r = await site("web_gift_paid", [w.start.reference, "cs_test_wrong_amount", "pay_test_late_1", 50000, "card", 1600, 48400, true], true);
  const late = await one("select status, receipt_no from shop.gifts where reference = $1", [w.start.reference]);
  check("a payment that arrives late is still recorded, with its receipt", got(r)?.ok === true && late.status === "paid" && /^LAF-CSH-/.test(late.receipt_no ?? ""), JSON.stringify([r, late]));
  const accented = got(await site("web_gift_start", [h("s-b"), { amount: 100, name: "Ma. Señora Ibañez-D'Cruz Jr." }], true));
  check("a name with accents, a full stop, a hyphen and an apostrophe is accepted as typed", accented?.ok === true && (await one("select receipt_name from shop.gifts where reference = $1", [accented.reference])).receipt_name === "Ma. Señora Ibañez-D'Cruz Jr.", JSON.stringify(accented));
  for (let i = 0; i < 6; i++) await site("web_gift_start", [h("s-b"), { amount: 100 }], true);
  r = await site("web_gift_start", [h("s-b"), { amount: 100 }], true);
  check("no more than six gifts are started by one customer in an hour", got(r)?.ok === false && got(r)?.error === "limit", JSON.stringify(r));

  console.log("-- a closed month, and the job that tries again");
  const month = today.slice(0, 7);
  await c.query("insert into ops.month_closes (month, closed) values ($1, true) on conflict (month) do update set closed = true", [month]).catch(async (e) => { throw new Error("month_closes fixture: " + e.message); });
  const giftsBeforeClosed = (await register()).gifts;
  const counterClosed = await counter();
  await c.query("update shop.gifts set created_at = created_at - interval '2 hours' where customer_id = $1", [A.id]);
  const g7 = await give("s-a", { amount: 613 }, { live: true });
  check("when the month is closed the payment is still recorded", g7.paid?.ok === true && g7.row.status === "paid" && g7.row.live === true, JSON.stringify(g7.paid));
  check("but the gift waits, with a note for staff, and takes no number", g7.row.receipt_no === null && /is closed/.test(g7.row.attention ?? "") && (await register()).gifts === giftsBeforeClosed && (await counter()) === counterClosed, JSON.stringify(g7.row));
  await c.query("update ops.month_closes set closed = false where month = $1", [month]);
  const swept = await one("select shop.gifts_sweep() as n");
  const g7after = await one("select receipt_no, attention from shop.gifts where id = $1", [g7.row.id]);
  check("once the month is reopened, the job records it and clears the note", Number(swept.n) === 1 && /^LAF-CSH-/.test(g7after.receipt_no ?? "") && g7after.attention === null && (await register()).gifts === giftsBeforeClosed + 1, JSON.stringify([swept, g7after]));
  check("and running the job again records nothing twice", Number((await one("select shop.gifts_sweep() as n")).n) === 0 && (await register()).gifts === giftsBeforeClosed + 1);

  console.log("-- the bank matching leaves online gifts alone");
  // A cash deposit of exactly the last gift's amount, on its day: the only gift it could be matched to.
  await c.query("insert into ops.cash_deposits (year, line_key, deposit_date, amount) values ($1, 'zz-gift-check', $2, 613)", [Number(year), today]);
  r = await run(ids.admin, "select ops.auto_reconcile_cash() as r", [], true);
  check("the automatic matching still runs", r.ok, JSON.stringify(r));
  check("a cash deposit of the same amount on the same day is not matched to an online gift", (await num("select count(*) n from ops.donations where source_id like 'shop-gift:%' and deposit_id is not null")) === 0);
  // The same gift recorded as cash would be matched: it is the 'online' mark that keeps it out.
  await c.query("update ops.donations set payment_method = 'cash' where source_id = 'shop-gift:' || $1", [g7.row.id]);
  await run(ids.admin, "select ops.auto_reconcile_cash() as r", [], true);
  check("(the same gift marked as cash would have been matched, so the check above means something)", (await num("select count(*) n from ops.donations where source_id = 'shop-gift:' || $1 and deposit_id is not null", [g7.row.id])) === 1);

  console.log("-- staff");
  r = await run(ids.finance, "select count(*)::int n from shop.gifts");
  check("Finance reads the gifts", r.ok && r.rows[0].n >= 8, JSON.stringify(r));
  r = await run(ids.driver, "select count(*)::int n from shop.gifts");
  check("a driver reads none", r.ok && r.rows[0].n === 0, JSON.stringify(r));
  r = await run("anon", "select count(*) from shop.gifts");
  check("someone not signed in reads none", !r.ok || r.rows[0].count === "0", JSON.stringify(r));
  for (const [what, sql] of [["change a gift", "update shop.gifts set amount = 1 where true"], ["delete a gift", "delete from shop.gifts where true"], ["add a gift", `insert into shop.gifts (reference, customer_id, amount, anonymous) values ('LAF-GFT-2026-88888', '${A.id}', 5, true)`]]) {
    r = await run(ids.admin, sql);
    check(`even the Super Admin cannot ${what} from the browser`, !r.ok && r.code === "42501", JSON.stringify(r));
  }
  r = await run(ids.admin, "update shop.settings set gift_amounts = array[50, 500], gift_min = 100");
  check("an offered amount below the smallest gift is refused", !r.ok && /settings_giving_check/.test(r.error ?? ""), JSON.stringify(r));
  r = await run(ids.admin, "update shop.settings set gift_amounts = array[250, 750], gift_min = 150, gift_max = 20000, giving_open = false", [], true);
  check("a Shop editor changes the amounts and closes giving", r.ok && r.n === 1, JSON.stringify(r));
  r = await run(ids.finance, "update shop.settings set giving_open = true");
  check("a Shop viewer cannot", r.ok ? r.n === 0 : r.code === "42501", JSON.stringify(r));
  check("the customer trail has each gift", (await num("select count(*) n from shop.customer_events where event = 'gift' and customer_id = $1", [A.id])) === 7);

  console.log("-- closing an account");
  r = await site("web_customer_close", [h("s-b")], true);
  check("a customer who has given can close their account; the gifts and their receipts stay", got(r) === true && (await num("select count(*) n from shop.gifts where customer_id = $1 and receipt_no is not null", [B.id])) === 2 && (await num("select count(*) n from ops.donations where source_id like 'shop-gift:%'")) === 8, JSON.stringify(r));
} catch (e) {
  fail++;
  console.error("ERROR", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(`\n${pass} pass, ${fail} fail (rolled back)`);
process.exit(fail ? 1 : 0);
