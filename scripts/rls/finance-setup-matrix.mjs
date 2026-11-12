// The 0133 pre-flight (Financial Settings), on the development database and ALWAYS rolled back: applies the
// migration in a transaction and proves the seed, the setup checklist and who may read and change what.
// The seed counts hold only before the Super Admin starts settling notes.
//   node --env-file=.env.local scripts/rls/finance-setup-matrix.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";
const proj = new URL("../../", import.meta.url);
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
async function check(name, who, sql, expect) {
  await c.query("savepoint s");
  let r;
  try {
    if (who) await as(who);
    const q = await c.query(sql);
    r = { ok: true, rows: q.rows, n: q.rowCount };
  } catch (e) {
    r = { ok: false, error: e.message, code: e.code };
  }
  await c.query("rollback to savepoint s");
  await c.query("reset role");
  const good = expect(r);
  if (good) pass++;
  else fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name}  ${r.ok ? `rows=${r.n} ${JSON.stringify(r.rows?.[0] ?? "").slice(0, 160)}` : `${r.code} ${r.error.slice(0, 140)}`}`);
}
const checklist = (r) => (r.ok ? r.rows[0].j : null);
try {
  await c.query("begin");
  await c.query(readFileSync(new URL("supabase/migrations/0133_finance_setup.sql", proj), "utf8"));
  const ids = (await c.query(`select
    (select id from shared.staff where role = 'admin' and active limit 1) admin,
    (select id from shared.staff where role = 'finance' and active limit 1) finance,
    (select id from shared.staff where role = 'office_admin' and active limit 1) office,
    (select id from shared.staff where role = 'social_worker' and active limit 1) sw,
    (select id from shared.staff where role = 'driver' and active limit 1) driver,
    (select id from shared.staff where role = 'partner_viewer' and active limit 1) partner`)).rows[0];
  console.log("fixtures:", Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, !!v])));

  // The seed.
  await check("chart: 150 rows, 34 to settle, 24 headings", null, `select count(*)::int n, count(*) filter (where review_note is not null)::int flagged, count(*) filter (where is_header)::int headers from ops.coa_accounts`,
    (r) => r.ok && r.rows[0].n === 150 && r.rows[0].flagged === 34 && r.rows[0].headers === 24);
  await check("every child points at a parent in the chart", null, `select count(*)::int n from ops.coa_accounts a where parent_id is not null and not exists (select 1 from ops.coa_accounts p where p.id = a.parent_id)`, (r) => r.ok && r.rows[0].n === 0);
  await check("codes: 15, every ArkOS program mapped", null, `select (select count(*)::int from ops.fin_codes) n, (select count(*)::int from ops.programs where t3_id is null) unmapped`, (r) => r.ok && r.rows[0].n === 15 && r.rows[0].unmapped === 0);
  await check("expense types all point at real, postable accounts", null, `select count(*)::int n, count(*) filter (where a.is_header or a.id is null)::int bad from ops.expense_types e left join ops.coa_accounts a on a.id = e.account_id`, (r) => r.ok && r.rows[0].n > 50 && r.rows[0].bad === 0);
  await check("gasoline for patient transport is 5303, for errands 5934", null, `select string_agg(f.code || '=' || a.code, ',' order by f.code) s from ops.expense_types e join ops.fin_codes f on f.id = e.use_id join ops.coa_accounts a on a.id = e.account_id where e.label = 'Gasoline / fuel'`, (r) => r.ok && r.rows[0].s === "ADM=5934,TRN=5303");
  await check("the seed did not fill the change log", null, `select count(*)::int n from ops.finance_setup_log`, (r) => r.ok && r.rows[0].n === 0);

  // The checklist.
  await check("checklist: not ready, authority/funds/general open", ids.sw, `select ops.finance_setup_checklist() j`, (r) => {
    const j = checklist(r);
    if (j) console.log("   ", j.items.map((i) => `${i.key}:${i.done ? "done" : "open"} - ${i.detail}`).join("\n    "));
    return j && j.ready === false && j.items.length === 6 && j.items.every((i) => !i.done);
  });
  await check("a partner can't read the checklist", ids.partner, `select ops.finance_setup_checklist() j`, (r) => !r.ok && r.code === "42501");

  // Reads.
  await check("a driver reads the chart", ids.driver, `select count(*)::int n from ops.coa_accounts`, (r) => r.ok && r.rows[0].n === 150);
  await check("a partner reads none of the chart", ids.partner, `select count(*)::int n from ops.coa_accounts`, (r) => r.ok && r.rows[0].n === 0);
  await c.query("savepoint p"); await c.query(`insert into ops.payees (name, tin) values ('Test supplier', '123456789000')`);
  await check("a driver reads no payees (TINs)", ids.driver, `select count(*)::int n from ops.payees`, (r) => r.ok && r.rows[0].n === 0);
  await check("finance staff read the payees", ids.finance, `select count(*)::int n from ops.payees`, (r) => r.ok && r.rows[0].n === 1);
  await c.query("rollback to savepoint p");

  // Writes.
  await check("finance staff can't change the chart (no setup power)", ids.finance, `update ops.coa_accounts set name = 'x' where code = '1101' returning id`, (r) => r.ok && r.n === 0);
  await check("a social worker can't add an authority row", ids.sw, `insert into ops.voucher_authority (step, staff_id) values ('approve', '${ids.sw}')`, (r) => !r.ok && r.code === "42501");
  await check("nobody inserts a second settings row", ids.admin, `insert into ops.finance_settings (id) values (true)`, (r) => !r.ok);
  await check("the Super Admin settles a note, and it is logged with who", ids.admin, `with u as (update ops.coa_accounts set review_note = null where code = '5106' returning id) select (select count(*) from u)::int n`, (r) => r.ok && r.rows[0].n === 1);
  await c.query("savepoint lg");
  await as(ids.admin);
  await c.query(`update ops.coa_accounts set review_note = null where code = '5106'`);
  const log = (await c.query(`select count(*)::int n, bool_and(changed_by = $1) by_me, bool_and(before->>'review_note' is not null and after->>'review_note' is null) diff from ops.finance_setup_log`, [ids.admin])).rows[0];
  await c.query("rollback to savepoint lg");
  await c.query("reset role");
  const logOk = log.n === 1 && log.by_me && log.diff;
  if (logOk) pass++;
  else fail++;
  console.log(`${logOk ? "PASS" : "FAIL"}  the change log holds the change with who and before/after  ${JSON.stringify(log)}`);
  await check("settling both 5204s without renumbering is refused", ids.admin, `update ops.coa_accounts set review_note = null where code = '5204'`, (r) => !r.ok && r.code === "23505");
  await check("a TIN must be digits", ids.admin, `insert into ops.payees (name, tin) values ('x', '123-456-789')`, (r) => !r.ok && r.code === "23514");
  await check("finance staff can't grant themselves the setup power", ids.finance, `insert into shared.role_powers (role, power) values ('finance', 'finance_setup')`, (r) => !r.ok);
  await check("finance staff hold the export power", null, `select count(*)::int n from shared.role_powers where role = 'finance' and power = 'finance_export'`, (r) => r.ok && r.rows[0].n === 1);
  await check("authenticated may run the checklist", null, `select has_function_privilege('authenticated', 'ops.finance_setup_checklist()', 'execute') ok, has_function_privilege('authenticated', 'ops.log_finance_setup()', 'execute') logfn`, (r) => r.ok && r.rows[0].ok === true);

  // Removing what others still use is refused, never cascaded (code review, 10 Nov).
  await check("removing an account an expense type uses is refused", ids.admin, `delete from ops.coa_accounts where code = '5934'`, (r) => !r.ok && r.code === "23503");
  await check("removing a program code is refused while expense types use it", ids.admin, `delete from ops.fin_codes where code = 'TRN'`, (r) => !r.ok && r.code === "23503" && /expense_types_use_id_fkey/.test(r.error));
  await check("a signer's staff row is protected (restrict, not cascade)", null, `select string_agg(conname || '=' || confdeltype::text, ',' order by conname) s from pg_constraint where conrelid in ('ops.voucher_authority'::regclass, 'ops.expense_types'::regclass) and contype = 'f'`, (r) => r.ok && /expense_types_account_id_fkey=r/.test(r.rows[0].s) && /expense_types_use_id_fkey=r/.test(r.rows[0].s) && /voucher_authority_staff_id_fkey=r/.test(r.rows[0].s) && /voucher_authority_alternate_staff_id_fkey=n/.test(r.rows[0].s));
  await c.query("savepoint funds_off");
  await c.query(`update ops.cash_funds set active = false`);
  await c.query(`update ops.expense_types set use_id = md5('code:T2:OC')::uuid where label = 'Rent'`);
  await check("no petty cash fund in use keeps funds open; an expense type on a fund is flagged", ids.sw, `select ops.finance_setup_checklist() j`, (r) => {
    const items = checklist(r)?.items ?? [];
    const f = items.find((i) => i.key === "funds"), e = items.find((i) => i.key === "expense_types");
    console.log("   ", f?.detail, "|", e?.detail);
    return f && !f.done && /No petty cash/.test(f.detail) && /Rent/.test(e?.detail ?? "");
  });
  await c.query("rollback to savepoint funds_off");

  // A person granted "Sets up Finance" (not a Super Admin) works the settings and maps the programs.
  await check("finance staff can't map a program", ids.finance, `select ops.set_program_t3('prog-housing', null)`, (r) => !r.ok && r.code === "42501");
  await c.query("savepoint granted");
  await c.query(`insert into shared.role_powers (role, power) values ('finance', 'finance_setup')`);
  await check("with the power, finance staff change the chart", ids.finance, `update ops.coa_accounts set name = name where code = '1101' returning id`, (r) => r.ok && r.n === 1);
  await check("with the power, finance staff map a program (logged)", ids.finance, `select ops.set_program_t3('prog-meals', md5('code:T3:CCT')::uuid); select 1`, (r) => r.ok);
  await check("... a T1 code is refused as a program", ids.finance, `select ops.set_program_t3('prog-meals', md5('code:T1:ADM')::uuid)`, (r) => !r.ok && r.code === "23514");
  await c.query("rollback to savepoint granted");

  // Completing the setup turns the checklist ready.
  await c.query("savepoint setup_all");
  await c.query(`update ops.coa_accounts set code = '5205' where id = md5('coa:134')::uuid`);
  await c.query(`delete from ops.coa_accounts where code is null`);
  await c.query(`update ops.coa_accounts set review_note = null`);
  await c.query(`update ops.fin_codes set review_note = null`);
  await c.query(`update ops.expense_types set review_note = null`);
  await c.query(`insert into ops.coa_accounts (code, name, parent_id) values ('1105', 'GCash Fund', md5('coa:6')::uuid)`);
  await c.query(`update ops.cash_funds set float_amount = 10000, top_up_below = 3000, custodian_staff_id = $1, account_id = coalesce(account_id, (select id from ops.coa_accounts where code = '1105'))`, [ids.finance]);
  await c.query(`update ops.finance_settings set start_date = '2026-12-01', liquidation_days = 15`);
  for (const step of ["validate", "review", "approve", "approve_payment", "release"]) await c.query(`insert into ops.voucher_authority (step, staff_id) values ($1, $2)`, [step, ids.admin]);
  await c.query(`insert into ops.voucher_authority (step, requester_role, staff_id) select 'endorse', r.role, $1 from (select distinct role from shared.staff where active and role <> 'partner_viewer') r`, [ids.office]);
  await check("everything set: the checklist is ready", ids.sw, `select ops.finance_setup_checklist() j`, (r) => {
    const j = checklist(r);
    if (j && !j.ready) console.log("   ", j.items.filter((i) => !i.done).map((i) => `${i.key}: ${i.detail}`).join("\n    "));
    return j && j.ready === true;
  });
  await c.query(`update ops.voucher_authority set max_amount = 5000 where step = 'approve'`);
  await check("an approve limit of 5,000 with nobody above it reopens authority", ids.sw, `select ops.finance_setup_checklist() j`, (r) => {
    const a = checklist(r)?.items.find((i) => i.key === "authority");
    console.log("   ", a?.detail);
    return a && !a.done && /Approve/.test(a.detail);
  });
  await c.query(`insert into ops.voucher_authority (step, min_amount, staff_id) values ('approve', 5000, $1)`, [ids.finance]);
  await check("... and a second approver from 5,000 up closes it", ids.sw, `select ops.finance_setup_checklist() j`, (r) => checklist(r)?.items.find((i) => i.key === "authority")?.done === true);
  await c.query(`insert into ops.voucher_authority (step, min_amount, max_amount, staff_id) values ('review', 0, 100, $1)`, [ids.finance]);
  await c.query(`update ops.voucher_authority set min_amount = 200 where step = 'review' and max_amount is null`);
  await check("a gap between 100 and 200 for review is found", ids.sw, `select ops.finance_setup_checklist() j`, (r) => /Review/.test(checklist(r)?.items.find((i) => i.key === "authority")?.detail ?? ""));
  await c.query("rollback to savepoint setup_all");

  // 0144: the signers set in one form, in one transaction.
  await c.query(readFileSync(new URL("supabase/migrations/0144_authority_set.sql", proj), "utf8"));
  const rows = (who) => JSON.stringify([{ step: "validate", staff_id: who }, { step: "review", staff_id: ids.office }, { step: "approve", staff_id: ids.admin, max_amount: 5000 }]).replace(/'/g, "''");
  await check("a driver can't set the signers", ids.driver, `select ops.voucher_authority_set('${rows(ids.finance)}'::jsonb)`, (r) => !r.ok && r.code === "42501");
  await check("an empty list is refused", ids.admin, `select ops.voucher_authority_set('[]'::jsonb)`, (r) => !r.ok && r.code === "23514");
  await c.query("savepoint signers");
  await as(ids.admin);
  const set = await c.query(`select ops.voucher_authority_set('${rows(ids.finance)}'::jsonb) n`);
  await c.query("reset role");
  await check("the Super Admin sets them all at once (3 rows)", null, `select ${set.rows[0].n}::int n`, (r) => r.ok && r.rows[0].n === 3);
  await check("... the old rows went, the three new ones stay, each logged", null,
    `select (select count(*)::int from ops.voucher_authority) rows, (select count(*)::int from ops.finance_setup_log where table_name = 'voucher_authority' and action = 'INSERT') logged`,
    (r) => r.ok && r.rows[0].rows === 3 && r.rows[0].logged >= 3);
  await c.query("rollback to savepoint signers");
  await check("a bad step refuses the whole list (nothing half replaced)", ids.admin, `select ops.voucher_authority_set('[{"step":"review","staff_id":"${ids.office}"},{"step":"nonsense"}]'::jsonb)`, (r) => !r.ok);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
