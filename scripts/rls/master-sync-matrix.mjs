// Proves 0057 (LFCN case numbers, the CN left to the sheet, the new patient
// fields, the master-sheet sync log) against the live database, one scenario
// per transaction, every transaction rolled back. Same harness as
// scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1 acknowledges
// that lafopsys has one database.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/master-sync-matrix.mjs
// (0058 scenarios need 0058 applied, or passed as a pre-flight file)
// Pre-flight: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/master-sync-matrix.mjs supabase/migrations/0057_patient_master_sync.sql
import { Client } from "pg";
import { readFile } from "node:fs/promises";

if (process.env.RLS_ALLOW_PROD !== "1") {
  console.error("This targets the production database (rolled back per scenario). Set RLS_ALLOW_PROD=1 to run.");
  process.exit(1);
}
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD in .env.local.");
  process.exit(1);
}
const projectRef = "kptftyuzrnummbcjakro";
const region = "ap-northeast-1";
const client = new Client({
  connectionString: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
});

const ROLES = ["admin", "social_worker", "house_staff", "driver"];
const results = [];
const record = (name, verdict, detail = "") =>
  results.push({ scenario: name, result: verdict, detail: String(detail).replace(/\s+/g, " ").slice(0, 80) });

// A role with no account of its own borrows another account, whose role is
// rewritten for the duration of its rolled-back transaction (the guard on
// shared.staff.role only binds `authenticated`; here we are postgres).
async function accountIds() {
  const ids = {};
  for (const role of ROLES) {
    const { rows } = await client.query(
      `select id from shared.staff where role = $1 and (active or staff_code like 'RLSTEST-%')
       order by (staff_code like 'RLSTEST-%') desc, created_at limit 1`,
      [role]
    );
    ids[role] = rows[0]?.id ?? null;
  }
  const { rows: spare } = await client.query(
    `select id from shared.staff where staff_code like 'RLSTEST-%' and role not in ('admin') order by created_at limit 1`
  );
  for (const role of ROLES) {
    if (!ids[role] && spare[0]) {
      ids[role] = spare[0].id;
      console.log(`no ${role} account; borrowing a test account for it`);
    }
  }
  return ids;
}

const claims = (id) => JSON.stringify({ sub: id, role: "authenticated" });

/**
 * @param name    scenario label
 * @param actor   role name or null (no session)
 * @param opts    { setup: async fn run as postgres before the role switch }
 * @param body    async fn returning a pg result, run as the acting role
 * @param expect  (outcome) => boolean
 */
async function scenario(ids, name, actor, opts, body, expect) {
  if (actor && !ids[actor]) {
    record(name, "SKIP", `no ${actor} account`);
    return;
  }
  await client.query(PREFLIGHT.length ? "savepoint scenario" : "begin");
  try {
    if (actor) {
      // Test accounts are deactivated so they never show in a login roster;
      // current_staff_role() (0026) only answers for active staff.
      await client.query("update shared.staff set active = true, role = $2 where id = $1", [ids[actor], actor]);
    }
    if (opts?.setup) await opts.setup();
    await client.query("set local role authenticated");
    if (actor) await client.query("select set_config('request.jwt.claims', $1, true)", [claims(ids[actor])]);

    let outcome;
    try {
      const r = await body();
      outcome = { ok: true, rows: r.rowCount, data: r.rows };
    } catch (e) {
      outcome = { ok: false, code: e.code, msg: e.message };
    }
    record(name, expect(outcome) ? "PASS" : "FAIL", outcome.ok ? `ok, rows=${outcome.rows} ${JSON.stringify(outcome.data?.[0] ?? "")}` : `${outcome.code} ${outcome.msg}`);
  } catch (e) {
    record(name, "FAIL", `setup error: ${e.message}`);
  } finally {
    await client.query(PREFLIGHT.length ? "rollback to savepoint scenario" : "rollback");
  }
}

// --- assertion helpers -------------------------------------------------------
const denied = (r) => !r.ok && r.code === "42501";
const checkFailed = (r) => !r.ok && r.code === "23514";
const duplicate = (r) => !r.ok && r.code === "23505";
const rows = (n) => (r) => r.ok && r.rows === n;
const atLeast = (n) => (r) => r.ok && r.rows >= n;
const value = (field, v) => (r) => r.ok && r.rows === 1 && r.data[0][field] === v;

const q = (sql, params) => () => client.query(sql, params);
const last = (...steps) => async () => {
  let r;
  for (const s of steps) r = await client.query(s.sql, s.params);
  return r;
};

const PREFLIGHT = process.argv.slice(2);

// Fixtures: two approved referrals for new children, and B1/B2 free.
const R1 = "00000000-0000-4000-8000-00000000c0a1";
const R2 = "00000000-0000-4000-8000-00000000c0a2";
const OLD = "00000000-0000-4000-8000-00000000c0a9";
const TODAY = "(now() at time zone 'Asia/Manila')::date";
const YEAR = "extract(year from (now() at time zone 'Asia/Manila')::date)::int";
const seed = async () => {
  await client.query("update ops.units set status = 'available', lock_reason = null where id in ('unit-B1','unit-B2')");
  await client.query(
    `insert into ops.referrals (id, patient_name, referring_person, department, urgency, status, patient_first_name, patient_last_name, patient_sex)
     values ($1, 'One Kid', 'Dr. T', 'MSS', 'routine', 'approved', 'One', 'Kid', 'M'), ($2, 'Two Kid', 'Dr. T', 'MSS', 'routine', 'approved', 'Two', 'Kid', 'F')`,
    [R1, R2]
  );
};
const withSeed = (extra) => ({
  setup: async () => {
    await seed();
    if (extra) await extra();
  },
});
const oldPatient = () =>
  client.query(`insert into ops.patients (id, first_name, last_name, sex, status, admitted_at) values ($1, 'Old', 'Admit', 'M', 'ongoing', '2024-05-01')`, [OLD]);
const admitSql = (ref, unit) => `ops.check_in(p_unit_id => '${unit}', p_check_in_at => ${TODAY}, p_referral_id => '${ref}')`;
const numberOf = (ref) =>
  `(select substr(p.case_number, 11)::int from ops.patients p join ops.referrals r on r.admitted_patient_id = p.id where r.id = '${ref}')`;

async function main() {
  await client.connect();
  if (PREFLIGHT.length) {
    await client.query("begin");
    for (const file of PREFLIGHT) {
      await client.query(await readFile(file, "utf8"));
      console.log("pre-flight applied (rolled back at the end):", file);
    }
  }
  const ids = await accountIds();
  console.log("Acting accounts:", Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v ? "yes" : "none"])));

  await scenario(ids, "a new child gets an LFCN and no CN", "social_worker", withSeed(),
    last({ sql: `select ${admitSql(R1, "unit-B1")}` },
      { sql: `select p.patient_number is null and p.case_number ~ ('^LFCN-' || ${YEAR} || '-[0-9]{4}$') as ok
              from ops.referrals r join ops.patients p on p.id = r.admitted_patient_id where r.id = $1`, params: [R1] }),
    value("ok", true));
  await scenario(ids, "the next child gets the next number", "social_worker", withSeed(),
    last({ sql: `select ${admitSql(R1, "unit-B1")}` }, { sql: `select ${admitSql(R2, "unit-B2")}` },
      { sql: `select ${numberOf(R2)} - ${numberOf(R1)} as gap` }),
    value("gap", 1));
  await scenario(ids, "check_in reports the case number", "social_worker", withSeed(),
    q(`select (${admitSql(R1, "unit-B1")}) ->> 'case_number' like 'LFCN-%' as ok`), value("ok", true));
  await scenario(ids, "a record added directly (not via check_in) still gets an LFCN", "social_worker", withSeed(),
    q("insert into ops.patients (first_name, last_name, sex, status, admitted_at) values ('Direct', 'Add', 'F', 'ongoing', current_date) returning case_number like 'LFCN-%' as ok"),
    value("ok", true));
  await scenario(ids, "a child can be kept before the sheet records their sex (0058)", "admin", withSeed(),
    q("insert into ops.patients (first_name, last_name, status, admitted_at) values ('No', 'Sex', 'ongoing', current_date) returning sex is null and case_number like 'LFCN-%' as ok"),
    value("ok", true));
  await scenario(ids, "sex is still only M or F when given", "admin", withSeed(),
    q("insert into ops.patients (first_name, last_name, sex, status, admitted_at) values ('Bad', 'Sex', 'X', 'ongoing', current_date)"),
    checkFailed);
  await scenario(ids, "the year of first admission is in the number", "admin", withSeed(oldPatient),
    q(`select case_number like 'LFCN-2024-%' as ok from ops.patients where id = '${OLD}'`), value("ok", true));
  await scenario(ids, "a case number never changes", "admin", withSeed(oldPatient),
    q(`update ops.patients set case_number = 'LFCN-2024-9999' where id = '${OLD}'`), denied);
  await scenario(ids, "a badly shaped case number is refused", "admin", withSeed(),
    q("insert into ops.patients (first_name, last_name, sex, status, admitted_at, case_number) values ('Bad', 'Code', 'M', 'ongoing', current_date, 'LAF-2026-001-C')"),
    checkFailed);
  await scenario(ids, "staff cannot mint numbers directly", "admin", withSeed(), q("select ops.next_case_number(2026)"), denied);
  await scenario(ids, "an illness code outside the six is refused", "admin", withSeed(oldPatient),
    q(`update ops.patients set illness_code = 'X' where id = '${OLD}'`), checkFailed);
  await scenario(ids, "a priority outside A-D is refused", "admin", withSeed(oldPatient),
    q(`update ops.patients set priority = 'E' where id = '${OLD}'`), checkFailed);
  await scenario(ids, "social workers read the sync log", "social_worker",
    withSeed(() => client.query("insert into ops.master_sheet_sync_runs (trigger, status) values ('manual', 'success')")),
    q("select id from ops.master_sheet_sync_runs"), atLeast(1));
  await scenario(ids, "drivers do not read the sync log", "driver",
    withSeed(() => client.query("insert into ops.master_sheet_sync_runs (trigger, status) values ('manual', 'success')")),
    q("select id from ops.master_sheet_sync_runs"), rows(0));
  await scenario(ids, "nobody writes the sync log from the app", "admin", withSeed(),
    q("insert into ops.master_sheet_sync_runs (trigger) values ('manual')"), denied);

  // ---- 0064: changes found on the original sheet ----
  const change = (field = "status") =>
    client.query(
      `insert into ops.sheet_changes (sheet_cn, patient_id, kind, field, label, sheet_after, payload, sheet_row)
       values ('999', '${OLD}', 'field', '${field}', 'Status', 'Expired', '{"patient":{"status":"expired"}}', '{}')`
    );
  const withChange = { setup: async () => { await seed(); await oldPatient(); await change(); } };
  await scenario(ids, "social workers read changes found on the sheet", "social_worker", withChange, q("select id from ops.sheet_changes where sheet_cn = '999'"), rows(1));
  await scenario(ids, "drivers do not", "driver", withChange, q("select id from ops.sheet_changes where sheet_cn = '999'"), rows(0));
  await scenario(ids, "nobody writes a change directly", "admin", withChange,
    q(`insert into ops.sheet_changes (sheet_cn, kind, label, sheet_after, payload, sheet_row) values ('998', 'new_child', 'x', 'x', '{}', '{}')`), denied);
  await scenario(ids, "nobody applies one directly", "admin", withChange, q("update ops.sheet_changes set status = 'applied' where sheet_cn = '999'"), denied);
  await scenario(ids, "one waiting change per child and field", "admin", { setup: async () => { await seed(); await oldPatient(); await change(); } },
    async () => { await client.query("reset role"); return change(); }, (r) => !r.ok && r.code === "23505");
  await scenario(ids, "a field change names its child and field", "admin", withChange,
    async () => { await client.query("reset role"); return client.query(`insert into ops.sheet_changes (sheet_cn, kind, label, sheet_after, payload, sheet_row) values ('997', 'field', 'x', 'x', '{}', '{}')`); }, checkFailed);

  if (PREFLIGHT.length) await client.query("rollback");
  await client.end();
  console.table(results);
  const failed = results.filter((r) => r.result === "FAIL");
  const skipped = results.filter((r) => r.result === "SKIP");
  console.log(`${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e.message);
  try {
    await client.end();
  } catch {}
  process.exit(1);
});
