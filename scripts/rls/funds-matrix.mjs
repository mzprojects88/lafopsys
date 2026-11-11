// The 0138 + 0139 pre-flight (funds, cash advances and their liquidation, withholding; paying, the books, QuickBooks
// and the bank), on the development database and ALWAYS rolled back: applies the migrations in a transaction,
// completes Financial Settings there, and walks advances, petty cash slips, top-ups, withheld and paid vouchers
// through their steps.
//   node --env-file=.env.local scripts/rls/funds-matrix.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";

if (isProd() || !pgUrl().includes("kptftyuzrnummbcjakro")) throw new Error("dev only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
let pass = 0, fail = 0;
async function step(name, who, sql, params, expect, keep = true) {
  await c.query("savepoint s");
  let r;
  try {
    if (who) {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: "authenticated" })]);
      await c.query("set local role authenticated");
      await c.query("discard plans");
    }
    const q = await c.query(sql, params);
    r = { ok: true, rows: q.rows, n: q.rowCount };
  } catch (e) {
    r = { ok: false, error: e.message, code: e.code };
  }
  if (!r.ok || !keep) await c.query("rollback to savepoint s");
  await c.query("reset role");
  if (r.ok && keep) await c.query("release savepoint s");
  const good = expect(r);
  good ? pass++ : fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name}  ${r.ok ? `rows=${r.n} ${JSON.stringify(r.rows?.[0] ?? "").slice(0, 110)}` : `${r.code} ${r.error.slice(0, 120)}`}`);
  return r;
}
const refused = (code) => (r) => !r.ok && (!code || r.code === code);
const val = (r) => (r.ok ? Object.values(r.rows[0])[0] : undefined);
const one = async (sql, params = []) => Object.values((await c.query(sql, params)).rows[0])[0];

try {
  await c.query("begin");
  for (const m of ["0138_funds_advances_ewt.sql", "0139_payment_books_quickbooks.sql"]) await c.query(readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), "utf8"));
  const ids = (await c.query(`select
    (select id from shared.staff where role = 'admin' and active order by id limit 1) admin1,
    (select id from shared.staff where role = 'admin' and active order by id offset 1 limit 1) admin2,
    (select id from shared.staff where role = 'finance' and active limit 1) finance,
    (select id from shared.staff where role = 'office_admin' and active limit 1) office,
    (select id from shared.staff where role = 'social_worker' and active limit 1) sw,
    (select id from shared.staff where role = 'driver' and active limit 1) driver,
    (select id from shared.staff where role = 'chef' and active and extra_roles = '{}' limit 1) chef,
    (select md5('code:T2:UNR')::uuid) unr`)).rows[0];
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);

  // Complete Financial Settings (as postgres, rolled back with the rest). The social worker keeps the petty cash.
  await c.query(`update ops.coa_accounts set code = '5205' where id = md5('coa:134')::uuid`);
  await c.query(`delete from ops.coa_accounts where code is null`);
  for (const t of ["coa_accounts", "fin_codes", "expense_types", "recipient_categories"]) await c.query(`update ops.${t} set review_note = null`);
  await c.query(`insert into ops.coa_accounts (code, name, parent_id) values ('1105', 'GCash Fund', md5('coa:6')::uuid)`);
  await c.query(`update ops.cash_funds set float_amount = 10000, top_up_below = 3000, custodian_staff_id = $1, account_id = coalesce(account_id, (select id from ops.coa_accounts where code = '1105'))`, [ids.sw]);
  await c.query(`update ops.finance_settings set start_date = (now() at time zone 'Asia/Manila')::date, liquidation_days = 15, block_advance_when_overdue = true`);
  await c.query(`delete from ops.voucher_authority`);
  await c.query(`insert into ops.voucher_authority (step, staff_id) values ('validate', $1), ('review', $2), ('approve_payment', $3), ('release', $2)`, [ids.finance, ids.office, ids.admin2]);
  await c.query(`insert into ops.voucher_authority (step, max_amount, staff_id) values ('approve', 5000, $1)`, [ids.admin1]);
  await c.query(`insert into ops.voucher_authority (step, min_amount, staff_id) values ('approve', 5000, $1)`, [ids.admin2]);
  await c.query(`insert into ops.voucher_authority (step, requester_role, staff_id)
    select 'endorse', r.role, case when r.role = 'admin' then null when r.role = 'office_admin' then $2::uuid else $1::uuid end
    from (select distinct role from shared.staff where active and role <> 'partner_viewer') r`, [ids.office, ids.admin1]);
  const ready = await step("Financial Settings is complete in the fixture", ids.finance, `select (ops.finance_setup_checklist()->>'ready')::boolean ok`, [], (r) => r.ok && r.rows[0].ok === true);
  if (!ready.ok || !ready.rows[0].ok) throw new Error("Financial Settings not complete in the fixture");

  const gas = await one(`select md5('exp:Gasoline / fuel:code:T3:TRN')::uuid`);
  const item = (amount, extra = {}) => JSON.stringify([{ description: "Item", qty: 1, unit_cost: amount, expense_type_id: gas, ...extra }]);
  const header = (extra = {}) => JSON.stringify({ purpose: "Test", t2_id: ids.unr, pay_method: "cash", ...extra });
  const bdo = await one(`select id from ops.coa_accounts where code = '1101'`);
  /** Pays an approved voucher: its payment prepared (from BDO) and approved, then released, or released straight. */
  async function payOut(label, id) {
    for (;;) {
      const st = await one(`select ops.voucher_pay_step(v) from ops.vouchers v where v.id = $1`, [id]);
      if (!st) return;
      const who = st === "prepare_payment" ? ids.finance : st === "approve_payment" ? ids.admin2 : ids.office;
      const r = await step(`${label}: ${st.replace("_", " ")}`, who, `select ops.voucher_pay($1, $2, $3, 'REF-1')`, [id, st, st === "approve_payment" ? null : bdo], (r) => r.ok);
      if (!r.ok) return;
    }
  }
  /** Sends a saved request along: endorsed, prepared (optionally linking a payee), reviewed, approved; then paid. */
  async function walk(label, id, who, payee = null, sent = false, paid = true) {
    if (!sent) await step(`${label}: sent`, who, `select ops.voucher_act($1, 'submit')`, [id], (r) => r.ok);
    await step(`${label}: endorsed`, ids.office, `select ops.voucher_act($1, 'endorse')`, [id], (r) => r.ok);
    await step(`${label}: prepared`, ids.finance, `select ops.voucher_prepare($1, $2, null, '[]'::jsonb, null, $3) n`, [id, ids.unr, payee], (r) => r.ok);
    await step(`${label}: reviewed`, ids.office, `select ops.voucher_act($1, 'review')`, [id], (r) => r.ok);
    const total = Number(await one(`select total from ops.vouchers where id = $1`, [id]));
    await step(`${label}: approved`, total < 5000 ? ids.admin1 : ids.admin2, `select ops.voucher_act($1, 'approve')`, [id], (r) => r.ok && val(r) === "approved");
    if (paid) await payOut(label, id);
  }

  // 1. A cash advance and its liquidation.
  const adv = val(await step("the driver asks for a 3,000 cash advance", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "cash_advance", purpose: "Trip to Baguio" }), item(3000)], (r) => r.ok));
  await walk("advance", adv, ids.driver);
  await step("the driver sees it open, due in 15 days, not overdue", ids.driver, `select due, overdue from ops.advances_open() where voucher_id = $1`, [adv],
    (r) => r.ok && r.n === 1 && r.rows[0].overdue === false);
  await step("Finance sees it too", ids.finance, `select count(*)::int n from ops.advances_open() where voucher_id = $1`, [adv], (r) => r.ok && r.rows[0].n === 1);
  await step("a chef sees no one's advances", ids.chef, `select count(*)::int n from ops.advances_open()`, [], (r) => r.ok && r.rows[0].n === 0);
  await c.query(`update ops.voucher_events set at = now() - interval '20 days' where voucher_id = $1 and action = 'release'`, [adv]);
  await step("twenty days on, it is overdue", ids.driver, `select overdue from ops.advances_open() where voucher_id = $1`, [adv], (r) => r.ok && r.rows[0].overdue === true);
  const adv2 = val(await step("the driver drafts another advance", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "cash_advance" }), item(500)], (r) => r.ok));
  await step("... sending it waits for the overdue one", ids.driver, `select ops.voucher_act($1, 'submit')`, [adv2], (r) => !r.ok && /overdue cash advance/.test(r.error), false);
  await c.query(`update ops.finance_settings set block_advance_when_overdue = false`);
  await step("... with the setting off, it goes", ids.driver, `select ops.voucher_act($1, 'submit')`, [adv2], (r) => r.ok, false);
  await c.query(`update ops.finance_settings set block_advance_when_overdue = true`);
  await step("a reimbursement isn't held by the overdue advance", ids.driver, `select ops.voucher_act(ops.voucher_save(null, $1::jsonb, $2::jsonb), 'submit')`, [header({ kind: "reimbursement" }), item(200)], (r) => r.ok, false);
  await step("someone else can't liquidate the driver's advance", ids.sw, `select ops.voucher_liquidate($1)`, [adv], refused("42501"), false);
  await step("a liquidation can't be typed from scratch", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "liquidation" }), item(100)], refused("23514"), false);
  const liq = val(await step("the driver starts the liquidation: a draft with the advance's lines", ids.driver, `select ops.voucher_liquidate($1)`, [adv], (r) => r.ok));
  await step("... linked to its advance, 3,000, the driver's T4", null, `select v.advance_of = $2 linked, v.total, v.kind, v.t4_staff_id = $3 t4 from ops.vouchers v where v.id = $1`, [liq, adv, ids.driver],
    (r) => r.ok && r.rows[0].linked && Number(r.rows[0].total) === 3000 && r.rows[0].kind === "liquidation" && r.rows[0].t4);
  await step("a staff member without Requests edit can't start one", ids.chef, `select ops.voucher_liquidate($1)`, [adv], refused("42501"), false);
  await step("only one liquidation per advance", ids.driver, `select ops.voucher_liquidate($1)`, [adv], refused("23514"), false);
  await step("the driver corrects it to what was spent: 2,600 with the OR", ids.driver, `select ops.voucher_save($1, $2::jsonb, $3::jsonb)`, [liq, header({ kind: "liquidation", purpose: "Liquidation" }), item(2600, { or_number: "OR-77" })],
    (r) => r.ok);
  await step("... still linked, now 2,600", null, `select advance_of = $2 linked, total from ops.vouchers where id = $1`, [liq, adv], (r) => r.ok && r.rows[0].linked && Number(r.rows[0].total) === 2600);
  await step("its kind can't change", ids.driver, `select ops.voucher_save($1, $2::jsonb, $3::jsonb)`, [liq, header({ kind: "reimbursement" }), item(2600)], refused("23514"), false);
  await step("... a draft liquidation still leaves the advance overdue", ids.driver, `select overdue from ops.advances_open() where voucher_id = $1`, [adv], (r) => r.ok && r.rows[0].overdue === true);
  await step("the driver sends the liquidation", ids.driver, `select ops.voucher_act($1, 'submit')`, [liq], (r) => r.ok);
  await step("... once sent, the advance is no longer overdue (it waits for the signers)", ids.driver, `select overdue from ops.advances_open() where voucher_id = $1`, [adv], (r) => r.ok && r.rows[0].overdue === false);
  await walk("liquidation", liq, ids.driver, null, true);
  await step("the liquidation is a JV", null, `select voucher_type, voucher_number from ops.vouchers where id = $1`, [liq], (r) => r.ok && r.rows[0].voucher_type === "JV" && /^JV-/.test(r.rows[0].voucher_number));
  await step("the advance is settled: no longer open", ids.finance, `select count(*)::int n from ops.advances_open() where voucher_id = $1`, [adv], (r) => r.ok && r.rows[0].n === 0);

  // 2. Petty cash: slips, cash on hand, a top-up.
  const fund = await one(`select id from ops.cash_funds where kind = 'petty_cash' and active order by name limit 1`);
  const s1 = val(await step("a 500 petty cash slip", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "petty_cash" }), item(500)], (r) => r.ok));
  await walk("slip 1", s1, ids.driver);
  await step("cash on hand 9,500, one open slip, not low", ids.finance, `select open_count, cash_on_hand, low from ops.fund_status() where fund_id = $1`, [fund],
    (r) => r.ok && r.rows[0].open_count === 1 && Number(r.rows[0].cash_on_hand) === 9500 && r.rows[0].low === false);
  const s2 = val(await step("a 7,000 petty cash slip", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "petty_cash" }), item(7000)], (r) => r.ok));
  await walk("slip 2", s2, ids.driver);
  await step("cash on hand 2,500: below the 3,000 top-up point", ids.sw, `select cash_on_hand, low from ops.fund_status() where fund_id = $1`, [fund], (r) => r.ok && Number(r.rows[0].cash_on_hand) === 2500 && r.rows[0].low === true);
  await step("the driver (not Finance, not the custodian) sees no funds", ids.driver, `select count(*)::int n from ops.fund_status()`, [], (r) => r.ok && r.rows[0].n === 0);
  await step("... and can't ask for a top-up", ids.driver, `select ops.fund_topup_create($1)`, [fund], refused("42501"), false);
  const top = val(await step("the custodian asks for the top-up", ids.sw, `select ops.fund_topup_create($1)`, [fund], (r) => r.ok));
  await step("... a 7,500 draft, both slips linked to it", null, `select v.total, v.kind, (select count(*)::int from ops.vouchers s where s.replenished_by = v.id) slips from ops.vouchers v where v.id = $1`, [top],
    (r) => r.ok && Number(r.rows[0].total) === 7500 && r.rows[0].kind === "fund_topup" && r.rows[0].slips === 2);
  await step("no second top-up for the same slips", ids.sw, `select ops.fund_topup_create($1)`, [fund], (r) => !r.ok && /No slips/.test(r.error), false);
  await step("until it is approved, the cash on hand stays 2,500; nothing left to refill, a top-up on its way, not flagged low", ids.sw,
    `select cash_on_hand, to_refill, topup_pending, low from ops.fund_status() where fund_id = $1`, [fund],
    (r) => r.ok && Number(r.rows[0].cash_on_hand) === 2500 && r.rows[0].to_refill === 0 && r.rows[0].topup_pending === true && r.rows[0].low === false);
  await step("a top-up can't be edited as a request", ids.sw, `select ops.voucher_save($1, $2::jsonb, $3::jsonb)`, [top, header({ kind: "petty_cash" }), item(1)], refused(), false);
  await walk("top-up", top, ids.sw);
  await step("approved: the fund is full again, nothing open", ids.sw, `select open_count, cash_on_hand, low from ops.fund_status() where fund_id = $1`, [fund],
    (r) => r.ok && r.rows[0].open_count === 0 && Number(r.rows[0].cash_on_hand) === 10000 && r.rows[0].low === false);
  const s3 = val(await step("another slip, 800", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "petty_cash" }), item(800)], (r) => r.ok));
  await walk("slip 3", s3, ids.driver);
  const top2 = val(await step("a second top-up", ids.sw, `select ops.fund_topup_create($1)`, [fund], (r) => r.ok));
  await step("... sent and endorsed", ids.sw, `select ops.voucher_act($1, 'submit')`, [top2], (r) => r.ok);
  await step("... rejected by the endorser", ids.office, `select ops.voucher_act($1, 'reject', 'Wrong month')`, [top2], (r) => r.ok && val(r) === "rejected");
  await step("a rejected top-up frees its slip for the next one", null, `select replenished_by is null freed from ops.vouchers where id = $1`, [s3], (r) => r.ok && r.rows[0].freed === true);

  // 3. Withholding.
  await c.query(`insert into ops.ewt_rates (atc, description, rate) values ('WC158', 'Goods', 1), ('WC160', 'Services', 2) on conflict (atc) do update set rate = excluded.rate, active = true`);
  const sup = await one(`insert into ops.payees (name, kind, tin, ewt_atc) values ('Test Supplier', 'supplier', '123456789', 'WC160') returning id`);
  const s4 = val(await step("a 1,000 petty cash slip to the supplier", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "petty_cash" }), item(1000)], (r) => r.ok));
  await walk("slip 4 (Finance links the supplier: 2% withheld)", s4, ids.driver, sup);
  await step("the fund paid the net: 9,200 - 980 = 8,220 on hand", ids.sw, `select cash_on_hand from ops.fund_status() where fund_id = $1`, [fund], (r) => r.ok && Number(r.rows[0].cash_on_hand) === 8220);
  const top3 = val(await step("... and its top-up refills the net", ids.sw, `select ops.fund_topup_create($1)`, [fund], (r) => r.ok));
  await step("... 800 + 980 = 1,780", null, `select total from ops.vouchers where id = $1`, [top3], (r) => r.ok && Number(r.rows[0].total) === 1780);
  const person = await one(`insert into ops.payees (name, kind, ewt_atc) values ('Test Person', 'person', 'WC158') returning id`);
  const gone = await one(`insert into ops.payees (name, kind, active) values ('Old Supplier', 'supplier', false) returning id`);
  const pay = val(await step("a 10,000 supplier payment", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "supplier", payee_id: sup }), item(10000)], (r) => r.ok));
  await step("... sent", ids.sw, `select ops.voucher_act($1, 'submit')`, [pay], (r) => r.ok);
  await step("... endorsed", ids.office, `select ops.voucher_act($1, 'endorse')`, [pay], (r) => r.ok);
  await step("Finance can't link a payee no longer in use", ids.finance, `select ops.voucher_prepare($1, $2, null, '[]'::jsonb, null, $3)`, [pay, ids.unr, gone], refused("23514"), false);
  await step("Finance picks no payee: nothing withheld, the supplier kept", ids.finance,
    `select ops.voucher_prepare($1, $2, null, '[]'::jsonb), (select ewt_total from ops.vouchers where id = $1) ewt, (select payee_id = $3 from ops.vouchers where id = $1) kept`, [pay, ids.unr, sup],
    (r) => r.ok && Number(r.rows[0].ewt) === 0 && r.rows[0].kept === true, false);
  await step("Finance prepares it with the supplier linked: 2% withheld (WC160)", ids.finance, `select ops.voucher_prepare($1, $2, null, '[]'::jsonb, null, $3) n`, [pay, ids.unr, sup], (r) => r.ok);
  await step("... 200 withheld; the net is 9,800", null, `select v.ewt_total, l.ewt_atc, l.ewt_rate, l.ewt_amount from ops.vouchers v join ops.voucher_lines l on l.voucher_id = v.id where v.id = $1`, [pay],
    (r) => r.ok && Number(r.rows[0].ewt_total) === 200 && r.rows[0].ewt_atc === "WC160" && Number(r.rows[0].ewt_amount) === 200);
  const cat = await one(`select id from ops.recipient_categories where active order by sort limit 1`);
  const purpose = await one(`select id from ops.expense_types where for_person and active order by sort limit 1`);
  const toPerson = val(await step("a 1,500 payment to a person", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`,
    [header({ kind: "supplier", to_person: true, recipient_category_id: cat, recipient_name: "Test Person" }), item(1500, { expense_type_id: purpose })], (r) => r.ok));
  await step("the requester can't attach a payee to a person", null, `select payee_id is null ok from ops.vouchers where id = $1`, [toPerson], (r) => r.ok && r.rows[0].ok);
  await step("... sent", ids.sw, `select ops.voucher_act($1, 'submit')`, [toPerson], (r) => r.ok);
  await step("... endorsed", ids.office, `select ops.voucher_act($1, 'endorse')`, [toPerson], (r) => r.ok);
  await step("Finance links the person as payee: 1% withheld (WC158)", ids.finance, `select ops.voucher_prepare($1, $2, null, '[]'::jsonb, null, $3)`, [toPerson, ids.unr, person], (r) => r.ok);
  await step("... 15 withheld, the person still named", null, `select ewt_total, recipient_name is not null named, payee_id = $2 linked from ops.vouchers where id = $1`, [toPerson, person],
    (r) => r.ok && Number(r.rows[0].ewt_total) === 15 && r.rows[0].named && r.rows[0].linked);
  await step("a payee without an ATC withholds nothing", null, `select ewt_total from ops.vouchers where id = $1`, [s1], (r) => r.ok && Number(r.rows[0].ewt_total) === 0);
  // 4. Paying.
  const reim = val(await step("a 2,000 reimbursement paid by check", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "reimbursement", pay_method: "check" }), item(2000)], (r) => r.ok));
  await walk("reimbursement", reim, ids.driver, null, false, false);
  await step("Finance has its payment to prepare", ids.finance, `select count(*)::int n from ops.voucher_queue() where voucher_id = $1 and step = 'prepare_payment'`, [reim], (r) => r.ok && r.rows[0].n === 1);
  await step("the requester can't prepare their own payment", ids.driver, `select ops.voucher_pay($1, 'prepare_payment', $2, 'CHK-1')`, [reim, bdo], refused("42501"), false);
  await step("a payment from an expense account is refused", ids.finance, `select ops.voucher_pay($1, 'prepare_payment', (select id from ops.coa_accounts where code = '5303'), 'CHK-1')`, [reim], refused("23514"), false);
  await step("a check needs its number", ids.finance, `select ops.voucher_pay($1, 'prepare_payment', $2)`, [reim, bdo], refused("23514"), false);
  await step("approving the payment waits for it to be prepared", ids.admin2, `select ops.voucher_pay($1, 'approve_payment')`, [reim], refused("23514"), false);
  await step("Finance prepares the payment: BDO, check 1001", ids.finance, `select ops.voucher_pay($1, 'prepare_payment', $2, 'CHK-1001')`, [reim, bdo], (r) => r.ok && val(r) === "payment_prepared");
  await c.query(`insert into ops.voucher_authority (step, staff_id) values ('approve_payment', $1), ('release', $1)`, [ids.finance]);
  await step("the payment's preparer can't also approve it", ids.finance, `select ops.voucher_pay($1, 'approve_payment')`, [reim], refused("42501"), false);
  await step("the signatory approves the payment", ids.admin2, `select ops.voucher_pay($1, 'approve_payment')`, [reim], (r) => r.ok && val(r) === "payment_approved");
  await step("the payment's preparer can't release it either", ids.finance, `select ops.voucher_pay($1, 'release')`, [reim], refused("42501"), false);
  await c.query(`delete from ops.voucher_authority where staff_id = $1 and step in ('approve_payment', 'release')`, [ids.finance]);
  await step("the releaser releases it", ids.office, `select ops.voucher_pay($1, 'release')`, [reim], (r) => r.ok && val(r) === "released");
  await step("... posted to the cash book: 2,000 out, by program", null, `select sum(amount)::numeric t, count(*)::int n, bool_and(direction = 'outflow' and source = 'voucher') ok from ops.cash_entries where source_id like 'voucher:' || $1 || '%'`, [reim],
    (r) => r.ok && Number(r.rows[0].t) === 2000 && r.rows[0].ok);
  await step("released once only", ids.office, `select ops.voucher_pay($1, 'release')`, [reim], refused("23514"), false);
  const stop = val(await step("another reimbursement, approved", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "reimbursement" }), item(300)], (r) => r.ok));
  await walk("to cancel", stop, ids.driver, null, false, false);
  await step("the requester can't cancel it once approved", ids.driver, `select ops.voucher_act($1, 'cancel', 'not needed')`, [stop], refused(), false);
  await step("Finance can, before it is paid", ids.finance, `select ops.voucher_act($1, 'cancel', 'Paid another way')`, [stop], (r) => r.ok && val(r) === "cancelled");
  const adv3 = val(await step("a 500 advance", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "cash_advance" }), item(500)], (r) => r.ok));
  await c.query(`update ops.finance_settings set block_advance_when_overdue = false`);
  await walk("advance 3", adv3, ids.driver, null, false, false);
  await step("approved but not yet paid: not open, and not to liquidate yet", ids.driver, `select (select count(*)::int from ops.advances_open() where voucher_id = $1) n`, [adv3], (r) => r.ok && r.rows[0].n === 0);
  await step("... liquidating waits for the cash", ids.driver, `select ops.voucher_liquidate($1)`, [adv3], refused("42501"), false);
  await payOut("advance 3", adv3);
  await step("paid: open, due from the release", ids.driver, `select count(*)::int n from ops.advances_open() where voucher_id = $1`, [adv3], (r) => r.ok && r.rows[0].n === 1);
  const liq3 = val(await step("the driver liquidates: nothing spent", ids.driver, `select ops.voucher_liquidate($1)`, [adv3], (r) => r.ok));
  await step("... the item at 0", ids.driver, `select ops.voucher_save($1, $2::jsonb, $3::jsonb)`, [liq3, header({ kind: "liquidation", purpose: "Trip cancelled" }), item(0)], (r) => r.ok);
  await walk("zero liquidation", liq3, ids.driver, null, false, false);
  await step("settling needs the account the change goes back to", ids.office, `select ops.voucher_pay($1, 'release')`, [liq3], refused("23514"), false);
  await step("settled into BDO", ids.office, `select ops.voucher_pay($1, 'release', $2)`, [liq3, bdo], (r) => r.ok && val(r) === "released");
  await step("... the advance's 500 taken back: nothing spent, cash net 0", null,
    `select sum(amount)::numeric t from ops.cash_entries where (source_id like 'voucher:' || $1 || ':%' or source_id like 'voucher:' || $2 || ':%') and direction = 'outflow'`, [adv3, liq3],
    (r) => r.ok && Number(r.rows[0].t) === 0);
  await step("the 3,000 advance liquidated at 2,600: spending 2,600 by the liquidation's program", null,
    `select sum(amount)::numeric t, count(distinct program_id)::int p from ops.cash_entries where (source_id like 'voucher:' || $1 || ':%' or source_id like 'voucher:' || $2 || ':%') and direction = 'outflow'`, [adv, liq],
    (r) => r.ok && Number(r.rows[0].t) === 2600);
  await step("... and the advance is settled", ids.driver, `select count(*)::int n from ops.advances_open() where voucher_id = $1`, [adv3], (r) => r.ok && r.rows[0].n === 0);
  await step("a top-up posts nothing to the cash book (the slips did)", null, `select count(*)::int n from ops.cash_entries where source_id like 'voucher:' || $1 || '%'`, [top], (r) => r.ok && r.rows[0].n === 0);

  await step("the only releaser can't send a request nobody else could release", ids.office, `select ops.voucher_act(ops.voucher_save(null, $1::jsonb, $2::jsonb), 'submit')`, [header({ kind: "reimbursement" }), item(100)],
    (r) => !r.ok && /release/.test(r.error), false);
  await step("nobody calls the payment-signing helper directly", ids.driver, `select ops.voucher_may_pay(v, 'release', $2) from ops.vouchers v where v.id = $1`, [reim, ids.driver], refused("42501"), false);

  // 5. QuickBooks.
  const today = await one(`select (now() at time zone 'Asia/Manila')::date::text`);
  await c.query("savepoint noacc");
  await c.query(`update ops.finance_settings set advances_account_id = null`);
  await step("no advances account set: no file, rather than a journal that doesn't balance", ids.finance, `select count(*) from ops.voucher_qb_export($1, $1)`, [today], refused("23514"), false);
  await c.query("rollback to savepoint noacc");
  await step("a driver can't export", ids.driver, `select count(*) from ops.voucher_qb_export($1, $1)`, [today], refused("42501"), false);
  const qb = await step("Finance exports today's journal", ids.finance, `select * from ops.voucher_qb_export($1, $1)`, [today], (r) => r.ok && r.n > 0);
  const byJournal = new Map();
  for (const row of qb.rows ?? []) {
    const j = byJournal.get(row.journal_no) ?? { d: 0, c: 0 };
    j.d += Number(row.debit ?? 0);
    j.c += Number(row.credit ?? 0);
    byJournal.set(row.journal_no, j);
  }
  await step("every entry balances (debits = credits)", null, `select 1`, [], () => byJournal.size > 0 && [...byJournal.values()].every((j) => Math.abs(j.d - j.c) < 0.005));
  const jv = (qb.rows ?? []).filter((r) => r.voucher_id === liq);
  await step("the 2,600 liquidation: lines debited, 1401 credited 3,000, 400 change debited to BDO", null, `select 1`, [],
    () => jv.some((r) => r.account.startsWith("1401") && Number(r.credit) === 3000) && jv.some((r) => r.account.startsWith("1101") && Number(r.debit) === 400));
  const paidCheck = (qb.rows ?? []).filter((r) => r.voucher_id === reim);
  await step("the check: 2,000 credited to BDO with its number", null, `select 1`, [], () => paidCheck.some((r) => r.account.startsWith("1101") && Number(r.credit) === 2000 && /CHK-1001/.test(r.description)));
  await step("Finance exports and marks them", ids.finance, `select count(*)::int n from ops.voucher_qb_export($1, $1, true)`, [today], (r) => r.ok && r.rows[0].n > 0);
  await step("a second export says they were exported before", ids.finance, `select bool_and(already_exported) ok from ops.voucher_qb_export($1, $1)`, [today], (r) => r.ok && r.rows[0].ok === true);

  // 6. The bank.
  const tx = await one(`insert into ops.bank_transactions (account_id, import_id, row_seq, posting_date, description, debit, running_balance, check_number)
    select account_id, import_id, 999999, (now() at time zone 'Asia/Manila')::date, 'TEST CHECK 1001', 2000, 0, 'CHK-1001' from ops.bank_transactions limit 1 returning id`);
  const wrong = await one(`insert into ops.bank_transactions (account_id, import_id, row_seq, posting_date, description, debit, running_balance)
    select account_id, import_id, 999998, (now() at time zone 'Asia/Manila')::date, 'TEST OTHER', 1999, 0 from ops.bank_transactions limit 1 returning id`);
  await step("a driver can't match to the bank", ids.driver, `select ops.voucher_bank_match($1, $2)`, [reim, tx], refused("42501"), false);
  await step("a debit of another amount is refused", ids.finance, `select ops.voucher_bank_match($1, $2)`, [reim, wrong], refused("23514"), false);
  await step("Finance matches the check to its bank debit", ids.finance, `select ops.voucher_bank_match($1, $2)`, [reim, tx], (r) => r.ok);
  await step("... the debit is marked matched to the voucher's cash entry", null, `select t.matched_cash_entry_id is not null m, v.bank_transaction_id = t.id linked from ops.bank_transactions t, ops.vouchers v where t.id = $1 and v.id = $2`, [tx, reim],
    (r) => r.ok && r.rows[0].m && r.rows[0].linked);
  await step("the same debit can't serve another voucher", ids.finance, `select ops.voucher_bank_match($1, $2)`, [liq3, tx], refused("23514"), false);
  await step("unmatching frees the debit", ids.finance, `select ops.voucher_bank_match($1, null), (select matched_cash_entry_id is null from ops.bank_transactions where id = $2) freed`, [reim, tx], (r) => r.ok, false);
  await step("the funds page is seeded: Finance edits, the CEO views", null, `select string_agg(role || '=' || level, ',' order by role) s from shared.role_page_access where page = 'finance.funds'`, [],
    (r) => r.ok && /finance=edit/.test(r.rows[0].s) && /ceo=view/.test(r.rows[0].s));
} finally {
  await c.query("rollback");
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
