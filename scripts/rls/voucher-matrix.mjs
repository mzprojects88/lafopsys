// The 0134 pre-flight (payment requests and vouchers), on the development database and ALWAYS rolled back:
// applies the migration in a transaction, completes Financial Settings there, and walks requests through every
// step, proving who may read, sign, send back and see what. Nothing it does survives the rollback.
//   node --env-file=.env.local scripts/rls/voucher-matrix.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";

if (isProd() || !pgUrl().includes("kptftyuzrnummbcjakro")) throw new Error("dev only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
let pass = 0, fail = 0;
const as = async (who) => {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: "authenticated" })]);
  await c.query("set local role authenticated");
  await c.query("discard plans");
};
/** Runs `sql` as `who`; kept unless `keep` is false (then rolled back to before it). */
async function step(name, who, sql, params, expect, keep = true) {
  await c.query("savepoint s");
  let r;
  try {
    if (who) await as(who);
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
const GAS_TRN = "md5('exp:Gasoline / fuel:code:T3:TRN')::uuid";
const UNR = "md5('code:T2:UNR')";

try {
  await c.query("begin");
  // 0139 changed advances_open's columns; re-applying 0138 over a database that has 0139 needs it gone first.
  await c.query("drop function if exists ops.advances_open()");
  for (const m of ["0134_vouchers.sql", "0135_pay_a_person.sql", "0136_voucher_history_fixes.sql", "0138_funds_advances_ewt.sql", "0139_payment_books_quickbooks.sql", "0140_finance_picks_fund_ledger.sql"]) await c.query(readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), "utf8"));
  const ids = (await c.query(`select
    (select id from shared.staff where role = 'admin' and active order by id limit 1) admin1,
    (select id from shared.staff where role = 'admin' and active order by id offset 1 limit 1) admin2,
    (select id from shared.staff where role = 'finance' and active limit 1) finance,
    (select id from shared.staff where role = 'office_admin' and active limit 1) office,
    (select id from shared.staff where role = 'social_worker' and active limit 1) sw,
    (select id from shared.staff where role = 'driver' and active limit 1) driver,
    (select id from shared.staff where role = 'chef' and active and extra_roles = '{}' limit 1) chef,
    (select id from shared.staff where role = 'partner_viewer' and active limit 1) partner,
    (select id from shared.staff where active and role = 'board' limit 1) board,
    (select md5('code:T2:UNR')::uuid) unr, (select md5('code:T2:OC')::uuid) oc`)).rows[0];
  if (!ids.chef) throw new Error("fixture missing: an active chef with no extra roles (the no-Patients-access requester)");
  console.log("fixtures:", Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, !!v])));
  const lines = JSON.stringify([{ description: "Diesel", qty: 2, unit_cost: 1500, expense_type_id: (await c.query(`select ${GAS_TRN} id`)).rows[0].id, or_number: "OR-1001" }]);
  const header = (extra = {}) => JSON.stringify({ kind: "reimbursement", purpose: "Fuel for the NCH run", t2_id: ids.unr, pay_method: "cash", ...extra });

  // A draft, before Financial Settings is complete.
  const d = await step("the social worker saves a draft", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`, [header(), lines], (r) => r.ok);
  const vid = val(d);
  await step("the server codes the line from the expense type: 5303, TRN under PRG, 2 x 1,500", null,
    `select a.code, t3.code t3, t1.code t1, l.amount, v.total, v.status from ops.voucher_lines l join ops.vouchers v on v.id = l.voucher_id join ops.coa_accounts a on a.id = l.account_id
     left join ops.fin_codes t3 on t3.id = l.t3_id join ops.fin_codes t1 on t1.id = l.t1_id where l.voucher_id = $1`, [vid],
    (r) => r.ok && r.rows[0].code === "5303" && r.rows[0].t3 === "TRN" && r.rows[0].t1 === "PRG" && Number(r.rows[0].total) === 3000 && r.rows[0].status === "draft");
  await step("the requester's fund is ignored: Finance picks it (0140)", null, `select t2_id is null ok from ops.vouchers where id = $1`, [vid], (r) => r.ok && r.rows[0].ok === true);
  await step("sending it is refused while Financial Settings is open", ids.sw, `select ops.voucher_act($1, 'submit')`, [vid], refused("23514"), false);
  await step("nobody writes the tables directly", ids.sw, `update ops.vouchers set total = 1 where id = $1`, [vid], refused("42501"), false);
  if (ids.board) await step("a board member (view only) can't file a request", ids.board, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header(), lines], (r) => (ids.board ? refused("42501")(r) : true), false);
  await step("a supplier payment needs its supplier", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ kind: "supplier" }), lines], refused("23514"), false);

  // Complete Financial Settings (as postgres, rolled back with the rest).
  await c.query(`update ops.coa_accounts set code = '5205' where id = md5('coa:134')::uuid`);
  await c.query(`delete from ops.coa_accounts where code is null`);
  await c.query(`update ops.coa_accounts set review_note = null`);
  await c.query(`update ops.fin_codes set review_note = null`);
  await c.query(`update ops.expense_types set review_note = null`);
  await c.query(`update ops.recipient_categories set review_note = null`);
  await c.query(`insert into ops.coa_accounts (code, name, parent_id) values ('1105', 'GCash Fund', md5('coa:6')::uuid)`);
  await c.query(`update ops.cash_funds set float_amount = 10000, top_up_below = 3000, custodian_staff_id = $1, account_id = coalesce(account_id, (select id from ops.coa_accounts where code = '1105'))`, [ids.finance]);
  await c.query(`update ops.finance_settings set start_date = (now() at time zone 'Asia/Manila')::date, liquidation_days = 15`);
  await c.query(`delete from ops.voucher_authority`);
  await c.query(`insert into ops.voucher_authority (step, staff_id) values ('validate', $1), ('review', $2), ('approve_payment', $3), ('release', $1)`, [ids.finance, ids.office, ids.admin2]);
  await c.query(`insert into ops.voucher_authority (step, max_amount, staff_id) values ('approve', 5000, $1)`, [ids.admin1]);
  // 0139: a second payment approver, so an admin's own request can be paid too.
  await c.query(`insert into ops.voucher_authority (step, staff_id) values ('approve_payment', $1)`, [ids.admin1]);
  await c.query(`insert into ops.voucher_authority (step, min_amount, staff_id) values ('approve', 5000, $1)`, [ids.admin2]);
  await c.query(`insert into ops.voucher_authority (step, requester_role, staff_id)
    select 'endorse', r.role, case when r.role = 'admin' then null when r.role = 'office_admin' then $2::uuid else $1::uuid end
    from (select distinct role from shared.staff where active and role <> 'partner_viewer') r`, [ids.office, ids.admin1]);
  await step("Financial Settings is now complete", null, `select (ops.finance_setup_checklist()->>'ready')::boolean ok`, [], (r) => {
    if (r.ok && !r.rows[0].ok) console.log("   ", JSON.stringify(r.rows[0]));
    return r.ok && r.rows[0].ok === true;
  });

  // Reads before sending.
  await step("a driver can't see the social worker's draft", ids.driver, `select count(*)::int n from ops.vouchers where id = $1`, [vid], (r) => r.ok && r.rows[0].n === 0);
  await step("the endorser can't see a draft", ids.office, `select count(*)::int n from ops.vouchers where id = $1 and status = 'draft'`, [vid], (r) => r.ok && r.rows[0].n === 0);
  await step("a partner sees nothing", ids.partner, `select count(*)::int n from ops.vouchers`, [], (r) => r.ok && r.rows[0].n === 0);

  // The full road.
  await step("the social worker sends it: REQ number, submitted", ids.sw, `select ops.voucher_act($1, 'submit') s, (select request_number from ops.vouchers where id = $1) n`, [vid],
    (r) => r.ok && r.rows[0].s === "submitted");
  await step("... numbered REQ-YYYY-NNNN, role kept", null, `select request_number, requester_role from ops.vouchers where id = $1`, [vid], (r) => r.ok && /^REQ-\d{4}-\d{4}$/.test(r.rows[0].request_number) && r.rows[0].requester_role === "social_worker");
  await step("the endorser now sees it and has it waiting", ids.office, `select count(*)::int n from ops.voucher_queue() q where q.voucher_id = $1 and q.step = 'endorse'`, [vid], (r) => r.ok && r.rows[0].n === 1);
  await step("the requester can't endorse their own request", ids.sw, `select ops.voucher_act($1, 'endorse')`, [vid], refused("42501"), false);
  await step("a driver can't endorse it", ids.driver, `select ops.voucher_act($1, 'endorse')`, [vid], refused(), false);
  await step("sending back needs a reason", ids.office, `select ops.voucher_act($1, 'return')`, [vid], refused("23514"), false);
  await step("the endorser sends it back with a reason", ids.office, `select ops.voucher_act($1, 'return', 'Add the OR photo')`, [vid], (r) => r.ok && val(r) === "returned");
  await step("the requester changes it and sends it again (same REQ number)", ids.sw,
    `select ops.voucher_save($1, $2::jsonb, $3::jsonb), ops.voucher_act($1, 'submit') s, (select request_number from ops.vouchers where id = $1) n`, [vid, header(), lines], (r) => r.ok && r.rows[0].s === "submitted");
  await step("the endorser endorses", ids.office, `select ops.voucher_act($1, 'endorse')`, [vid], (r) => r.ok && val(r) === "endorsed");
  await step("Finance has it waiting to prepare", ids.finance, `select count(*)::int n from ops.voucher_queue() where voucher_id = $1 and step = 'validate'`, [vid], (r) => r.ok && r.rows[0].n === 1);
  const lineId = (await c.query(`select id from ops.voucher_lines where voucher_id = $1`, [vid])).rows[0].id;
  const codeLines = async (code, t1, t3) =>
    JSON.stringify([{ id: lineId, account_id: (await c.query(`select id from ops.coa_accounts where code = $1 and review_note is null`, [code])).rows[0].id, t1_id: (await c.query(`select md5('code:T1:' || $1)::uuid id`, [t1])).rows[0].id, t3_id: t3 ? (await c.query(`select md5('code:T3:' || $1)::uuid id`, [t3])).rows[0].id : null }]);
  await step("Finance can't prepare without picking the fund", ids.finance, `select ops.voucher_prepare($1, null, null, '[]'::jsonb)`, [vid], (r) => !r.ok && /fund/.test(r.error), false);
  await c.query(`update ops.fin_codes set account_prefixes = '{52}' where code = 'OC'`);
  await step("One Child (restricted to 52xx) may not pay for 5303", ids.finance, `select ops.voucher_prepare($1, $2, null, $3::jsonb)`, [vid, ids.oc, await codeLines("5303", "PRG", "TRN")], (r) => !r.ok && /may not pay/.test(r.error), false);
  await step("a heading account is refused", ids.finance, `select ops.voucher_prepare($1, $2, null, $3::jsonb)`, [vid, ids.unr, await codeLines("5300", "PRG", "TRN")], (r) => !r.ok && /usable account/.test(r.error), false);
  await step("the office admin (not a validator) can't prepare", ids.office, `select ops.voucher_prepare($1, $2, null, $3::jsonb)`, [vid, ids.unr, await codeLines("5303", "PRG", "TRN")], refused("42501"), false);
  await step("Finance recodes to 5934 / ADM and prepares: PV number", ids.finance, `select ops.voucher_prepare($1, $2, null, $3::jsonb) n`, [vid, ids.unr, await codeLines("5934", "ADM", null)],
    (r) => r.ok && /^PV-\d{4}-\d{4}$/.test(val(r)));
  await step("the preparer can't also review", ids.finance, `select ops.voucher_act($1, 'review')`, [vid], refused("42501"), false);
  await step("the reviewer reviews", ids.office, `select ops.voucher_act($1, 'review')`, [vid], (r) => r.ok && val(r) === "reviewed");
  await step("the reviewer can't also approve (they hold no approve row either)", ids.office, `select ops.voucher_act($1, 'approve')`, [vid], refused("42501"), false);
  await step("the approver above 5,000 can't approve 3,000", ids.admin2, `select ops.voucher_act($1, 'approve')`, [vid], refused("42501"), false);
  await step("the approver up to 5,000 approves", ids.admin1, `select ops.voucher_act($1, 'approve')`, [vid], (r) => r.ok && val(r) === "approved");
  await step("the trail: submit, return, submit, endorse, prepare, review, approve", null, `select string_agg(action, ',' order by at, action) s from ops.voucher_events where voucher_id = $1`, [vid],
    (r) => r.ok && r.rows[0].s.split(",").length === 7);
  await step("an approved request can't be cancelled by its requester", ids.sw, `select ops.voucher_act($1, 'cancel', 'changed my mind')`, [vid], refused(), false);
  await step("Finance sees the approved voucher; the driver still doesn't", ids.driver, `select count(*)::int n from ops.vouchers where id = $1`, [vid], (r) => r.ok && r.rows[0].n === 0);

  // Other roads.
  const big = val(await step("a 6,000 request from the driver", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`,
    [header({ purpose: "Tyres" }), JSON.stringify([{ description: "Two tyres", qty: 2, unit_cost: 3000, expense_type_id: (await c.query(`select md5('exp:Vehicle repair and maintenance:code:T3:TRN')::uuid id`)).rows[0].id }])], (r) => r.ok));
  await step("... sent and endorsed", ids.driver, `select ops.voucher_act($1, 'submit')`, [big], (r) => r.ok);
  await step("... endorsed", ids.office, `select ops.voucher_act($1, 'endorse')`, [big], (r) => r.ok);
  await step("... prepared", ids.finance, `select ops.voucher_prepare($1, $2, null, '[]'::jsonb)`, [big, ids.unr], (r) => r.ok);
  await step("... reviewed", ids.office, `select ops.voucher_act($1, 'review')`, [big], (r) => r.ok);
  await step("the up-to-5,000 approver can't approve 6,000", ids.admin1, `select ops.voucher_act($1, 'approve')`, [big], refused("42501"), false);
  await step("the from-5,000 approver approves it", ids.admin2, `select ops.voucher_act($1, 'approve')`, [big], (r) => r.ok && val(r) === "approved");

  const pc = val(await step("a petty cash request", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`, [header({ kind: "petty_cash", purpose: "Water" }), lines], (r) => r.ok));
  await step("... is tied to the petty cash fund", null, `select f.kind from ops.vouchers v join ops.cash_funds f on f.id = v.fund_id where v.id = $1`, [pc], (r) => r.ok && r.rows[0]?.kind === "petty_cash");
  await step("... sent, endorsed and prepared: a PCV number", ids.sw, `select ops.voucher_act($1, 'submit')`, [pc], (r) => r.ok);
  await step("... endorsed", ids.office, `select ops.voucher_act($1, 'endorse')`, [pc], (r) => r.ok);
  await step("... prepared as PCV", ids.finance, `select ops.voucher_prepare($1, $2, null, '[]'::jsonb) n`, [pc, ids.unr], (r) => r.ok && /^PCV-/.test(val(r)));
  await step("a similar request (same OR number) is counted", ids.sw, `select ops.voucher_similar($1) n`, [pc], (r) => r.ok && r.rows[0].n >= 1);

  const g = val(await step("a GCash-paid request", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`, [header({ pay_method: "gcash", purpose: "Load" }), lines], (r) => r.ok));
  await step("... sent", ids.sw, `select ops.voucher_act($1, 'submit')`, [g], (r) => r.ok);
  await step("the requester cancels it before Finance prepares it (with a reason)", ids.sw, `select ops.voucher_act($1, 'cancel', 'Paid from my pocket')`, [g], (r) => r.ok && val(r) === "cancelled");

  const adminReq = val(await step("a Super Admin's request (the other approver signs it)", ids.admin2, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`, [header({ purpose: "Bank fee" }), lines], (r) => r.ok));
  await step("... skips endorsement (no endorser for the role)", ids.admin2, `select ops.voucher_act($1, 'submit') s`, [adminReq], (r) => r.ok && val(r) === "endorsed");
  await step("... and its requester may not approve it later", null, `select ops.voucher_may_sign(v, 'approve', $2) ok from ops.vouchers v where v.id = $1`, [adminReq, ids.admin2], (r) => r.ok && r.rows[0].ok === false);

  const dd = val(await step("a draft to throw away", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`, [header(), lines], (r) => r.ok));
  await step("the requester discards their unsent draft", ids.sw, `select ops.voucher_act($1, 'discard')`, [dd], (r) => r.ok && val(r) === "discarded");
  await step("someone else can't discard it", ids.driver, `select ops.voucher_act($1, 'discard')`, [pc], refused(), false);

  // Urgent approver rows count only on urgent requests.
  await c.query(`insert into ops.voucher_authority (step, staff_id, urgent) values ('approve', $1, true)`, [ids.finance]);
  const u = val(await step("an urgent request", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`, [header({ urgent: true, urgent_reason: "Patient discharge today", purpose: "Urgent fuel" }), lines], (r) => r.ok));
  await step("... urgent needs a reason (empty refused)", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`, [header({ urgent: true, urgent_reason: " " }), lines], refused(), false);
  for (const [w, a] of [[ids.sw, "submit"], [ids.office, "endorse"]]) await step(`... ${a}`, w, `select ops.voucher_act($1, '${a}')`, [u], (r) => r.ok);
  await step("... prepared by Finance", ids.finance, `select ops.voucher_prepare($1, $2, null, '[]'::jsonb)`, [u, ids.unr], (r) => r.ok);
  await step("... reviewed", ids.office, `select ops.voucher_act($1, 'review')`, [u], (r) => r.ok);
  await step("the urgent approver who prepared it still may not approve it", ids.finance, `select ops.voucher_act($1, 'approve')`, [u], refused("42501"), false);
  await step("the urgent approver row doesn't count on a normal request", null, `select ops.voucher_may_sign(v, 'approve', $2) ok from ops.vouchers v where v.id = $1`, [pc, ids.finance], (r) => r.ok && r.rows[0].ok === false);
  await c.query(`insert into ops.payees (name, tin) values ('Test Hardware', '123456789000')`);
  await step("a driver picks a supplier by name, without its TIN", ids.driver, `select * from ops.payee_choices() where name = 'Test Hardware'`, [], (r) => r.ok && r.n === 1 && !("tin" in r.rows[0]));
  await c.query(`insert into ops.payees (name, kind) values ('A family (burial aid)', 'person')`);
  await step("a person paid is not in the requesters' list", ids.driver, `select count(*)::int n from ops.payee_choices() where name like 'A family%'`, [], (r) => r.ok && r.rows[0].n === 0);
  await step("a partner gets no supplier names", ids.partner, `select count(*)::int n from ops.payee_choices()`, [], (r) => r.ok && r.rows[0].n === 0);
  // Code review fixes (11 Nov).
  await step("a skipped endorsement reads after its submit", null, `select string_agg(action, ',' order by at) s from ops.voucher_events where voucher_id = $1`, [adminReq], (r) => r.ok && r.rows[0].s === "submit,skip_endorse");
  const fd = val(await step("a draft with a file", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`, [header(), lines], (r) => r.ok));
  await c.query(`insert into ops.voucher_files (id, voucher_id, kind, object_key, file_name, content_type, bytes, uploaded_by) values (gen_random_uuid(), $1, 'receipt', 'test/' || gen_random_uuid(), 'or.jpg', 'image/jpeg', 10, $2)`, [fd, ids.sw]);
  await step("a draft with files can't be discarded (they would stay in the store)", ids.sw, `select ops.voucher_act($1, 'discard')`, [fd], refused("23514"), false);
  await step("Finance can't attach to someone's draft", ids.finance, `select ops.voucher_can_attach($1) ok`, [fd], (r) => r.ok && r.rows[0].ok === false);
  await step("Finance attaches after approval (the proof of payment, 0139)", ids.finance, `select ops.voucher_can_attach($1) ok`, [vid], (r) => r.ok && r.rows[0].ok === true);
  await step("... the requester can't", ids.sw, `select ops.voucher_can_attach($1) ok`, [vid], (r) => r.ok && r.rows[0].ok === false);
  await c.query(`update ops.voucher_authority set alternate_staff_id = null where step = 'endorse' and requester_role = 'office_admin'`);
  await c.query(`update ops.voucher_authority set staff_id = $1 where step = 'endorse' and requester_role = 'office_admin'`, [ids.office]);
  const own = val(await step("the office admin (sole endorser for their role) drafts a request", ids.office, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`, [header(), lines], (r) => r.ok));
  await step("... sending it is refused: nobody else would endorse it", ids.office, `select ops.voucher_act($1, 'submit')`, [own], (r) => !r.ok && /endorsement/.test(r.error), false);
  const back = val(await step("a request to send back", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`, [header({ purpose: "Back" }), lines], (r) => r.ok));
  await step("... sent", ids.sw, `select ops.voucher_act($1, 'submit')`, [back], (r) => r.ok);
  await step("... sent back", ids.office, `select ops.voucher_act($1, 'return', 'Wrong amount')`, [back], (r) => r.ok);
  await step("the requester's queue holds it as returned", ids.sw, `select count(*)::int n from ops.voucher_queue() where voucher_id = $1 and step = 'returned'`, [back], (r) => r.ok && r.rows[0].n === 1);
  // Paying a person (0135).
  await c.query(`update ops.recipient_categories set review_note = null`);
  const burial = (await c.query(`select md5('exp:Burial and bereavement:code:T3:NWB')::uuid id`)).rows[0].id;
  const pt = (await c.query(`select id from ops.patients order by created_at limit 1`)).rows[0]?.id;
  const catId = async (k) => (await c.query(`select md5('recipient:' || $1)::uuid id`, [k])).rows[0].id;
  const person = (extra) => header({ kind: "supplier", purpose: "Burial aid", to_person: true, ...extra });
  const burialLine = JSON.stringify([{ description: "Burial assistance", qty: 1, unit_cost: 5000, expense_type_id: burial }]);
  const pp = val(await step("the social worker files burial aid for a patient's family (patient picked)", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`,
    [person({ recipient_category_id: await catId("patient"), patient_id: pt, recipient_name: "" }), burialLine], (r) => r.ok));
  await step("... the name comes from the patient record; no supplier", null, `select to_person, recipient_name is not null as named, payee_id is null as no_payee from ops.vouchers where id = $1`, [pp],
    (r) => r.ok && r.rows[0].to_person && r.rows[0].named && r.rows[0].no_payee);
  await step("a chef (no Patients or House Ops access) can't pick a patient", ids.chef, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`,
    [person({ recipient_category_id: await catId("patient"), patient_id: pt }), burialLine], refused("42501"), false);
  await step("... but can type the person's name", ids.chef, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`,
    [person({ recipient_category_id: await catId("other"), recipient_name: "A neighbour" }), burialLine], (r) => r.ok);
  await step("paying a person needs a person purpose (gasoline refused)", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`,
    [person({ recipient_category_id: await catId("other"), recipient_name: "Someone" }), lines], (r) => !r.ok && /purpose for paying a person/.test(r.error), false);
  await step("paying a person needs a category and a name", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`,
    [person({ recipient_category_id: null, recipient_name: "Someone" }), burialLine], refused("23514"), false);
  await step("a person-paid request moves like any other: sent", ids.sw, `select ops.voucher_act($1, 'submit')`, [pp], (r) => r.ok);
  await step("... endorsed", ids.office, `select ops.voucher_act($1, 'endorse')`, [pp], (r) => r.ok);
  await step("... prepared (5501)", ids.finance, `select ops.voucher_prepare($1, $2, null, '[]'::jsonb) n`, [pp, ids.unr], (r) => r.ok && /^PV-/.test(val(r)));
  await step("a driver can't read the patient-family voucher", ids.driver, `select count(*)::int n from ops.vouchers where id = $1`, [pp], (r) => r.ok && r.rows[0].n === 0);
  await step("a cash advance can't go to a person", ids.sw, `select ops.voucher_save(null, $1::jsonb, $2::jsonb)`,
    [person({ kind: "cash_advance", recipient_category_id: await catId("other"), recipient_name: "Someone" }), burialLine], (r) => !r.ok && /direct payment or petty cash/.test(r.error), false);
  const twin = val(await step("a second burial aid for the same patient, by another requester", ids.driver, `select ops.voucher_save(null, $1::jsonb, $2::jsonb) id`,
    [person({ recipient_category_id: await catId("patient"), patient_id: pt }), burialLine], (r) => r.ok));
  await step("... sent", ids.driver, `select ops.voucher_act($1, 'submit')`, [twin], (r) => r.ok);
  await step("... is flagged as a possible duplicate (same patient, same total)", ids.driver, `select ops.voucher_similar($1) n`, [twin], (r) => r.ok && r.rows[0].n >= 1);
  await step("usage counts are for whoever sets up Finance only", ids.sw, `select count(*)::int n from ops.voucher_line_counts()`, [], (r) => r.ok && r.rows[0].n === 0);
  await step("... the Super Admin gets counts per account", ids.admin1, `select count(*)::int n from ops.voucher_line_counts()`, [], (r) => r.ok && r.rows[0].n > 0);
  // Correcting a voucher from the registers (0136).
  const hist = (await c.query(`insert into ops.vouchers (source, voucher_type, voucher_number, legacy_number, kind, status, purpose, total, needs_cleanup, cleanup_reasons)
    values ('sheet', 'PV', 'PV LAF-TEST-1', 'LAF-TEST-1', 'supplier', 'approved', 'Register row', 100, true, '{unknown_code,total_differs}') returning id`)).rows[0].id;
  const hline = (await c.query(`insert into ops.voucher_lines (voucher_id, sort, description, qty, unit_cost, amount, legacy_code) values ($1, 1, 'Item', 1, 100, 100, '59521') returning id`, [hist])).rows[0].id;
  const fixLines = async (code, t1) => JSON.stringify([{ id: hline, account_id: code ? (await c.query(`select id from ops.coa_accounts where code = $1 and review_note is null`, [code])).rows[0].id : null, t1_id: t1 ? (await c.query(`select md5('code:T1:' || $1)::uuid id`, [t1])).rows[0].id : null, t3_id: null }]);
  await step("a driver can't correct a register voucher", ids.driver, `select ops.voucher_fix_history($1, $2, $3::jsonb)`, [hist, ids.unr, await fixLines("5956", "ADM")], refused("42501"), false);
  await step("a heading account is refused in a correction", ids.finance, `select ops.voucher_fix_history($1, $2, $3::jsonb)`, [hist, ids.unr, await fixLines("5950", "ADM")], refused("23514"), false);
  await step("One Child (restricted to 52xx) may not take a 5956 bank fee in a correction", ids.finance, `select ops.voucher_fix_history($1, $2, $3::jsonb)`, [hist, ids.oc, await fixLines("5956", "ADM")], (r) => !r.ok && /may not pay/.test(r.error), false);
  await step("Finance corrects the coding: the coding flag goes, the total flag stays", ids.finance, `select ops.voucher_fix_history($1, $2, $3::jsonb, 'Bank fee') ok`, [hist, ids.unr, await fixLines("5956", "ADM")], (r) => r.ok && r.rows[0].ok === false);
  await step("... reasons left: total_differs", null, `select cleanup_reasons::text r, needs_cleanup from ops.vouchers where id = $1`, [hist], (r) => r.ok && r.rows[0].r === "{total_differs}" && r.rows[0].needs_cleanup === true);
  await step("Finance checks the total against the papers: cleaned up", ids.finance, `select ops.voucher_fix_history($1, $2, $3::jsonb, 'Total checked', true) ok`, [hist, ids.unr, await fixLines("5956", "ADM")], (r) => r.ok && r.rows[0].ok === true);
  await step("... the flag is off and both corrections are in the history, signed", null, `select v.needs_cleanup, (select count(*)::int from ops.voucher_events e where e.voucher_id = v.id and e.action = 'history' and e.actor = $2) n from ops.vouchers v where v.id = $1`, [hist, ids.finance],
    (r) => r.ok && r.rows[0].needs_cleanup === false && r.rows[0].n === 2);
  await step("a request filed in the app can't be 'corrected' as history", ids.finance, `select ops.voucher_fix_history($1, $2, '[]'::jsonb)`, [vid, ids.unr], refused("P0002"), false);
  await step("the categories are in the setup checklist", null, `select ops.finance_setup_checklist()->'items'->2->>'label' l`, [], (r) => r.ok && /recipient categories/.test(r.rows[0].l));
  await step("functions run as callers only where granted", null,
    `select has_function_privilege('authenticated', 'ops.voucher_may_sign(ops.vouchers, text, uuid)', 'execute') may, has_function_privilege('authenticated', 'ops.voucher_act(uuid, text, text)', 'execute') act`, [], (r) => r.ok && r.rows[0].may === false && r.rows[0].act === true);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
