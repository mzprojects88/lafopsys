// Proves the hr schema's row-level security (migrations 0035-0045) against
// the live database, one scenario per transaction, every transaction rolled
// back -- nothing persists. lafopsys has a single database, so this runs
// against production by design; RLS_ALLOW_PROD=1 acknowledges that.
//
// Same harness as laf-inventory's scripts/rls/policy-matrix.mjs: fixtures
// are inserted as postgres, then the connection switches to `set local role
// authenticated` with request.jwt.claims set to a real staff member's id --
// what PostgREST does for a signed-in session -- and runs one statement.
//
// Two ways the database says no, and the assertions distinguish them:
//   - INSERT that fails `with check`, or a guard trigger  -> error 42501
//   - UPDATE/DELETE whose row fails `using`               -> 0 rows, no error
//   - SELECT of rows the policy hides                     -> fewer rows
//
// Accounts: one active shared.staff row per role, preferring RLSTEST-*
// accounts (laf-inventory's scripts/rls/ensure-test-accounts.mjs) when they
// exist. "hr" is the social_worker account with is_hr flipped on inside its
// rolled-back transaction. A role with no account skips its scenarios.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/hr-policy-matrix.mjs
//
// Pre-flight: pass migration files as arguments to prove them BEFORE they
// are applied. The whole run then happens in one transaction -- the files
// first, then every scenario under a savepoint -- and is rolled back at
// the end, so production is untouched either way:
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/hr-policy-matrix.mjs supabase/migrations/0042_hr_payroll.sql
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

const ROLES = ["admin", "social_worker", "driver", "chef", "board", "finance"];
const results = [];
const record = (name, verdict, detail = "") =>
  results.push({ scenario: name, result: verdict, detail: String(detail).replace(/\s+/g, " ").slice(0, 72) });

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
  return ids;
}

const claims = (id) => JSON.stringify({ sub: id, role: "authenticated" });

// Fixture ids: employee A belongs to the acting person (linked to their
// login unless the scenario says otherwise), employee B is someone else.
const EMP_A = "00000000-0000-4000-8000-00000000e001";
const EMP_B = "00000000-0000-4000-8000-00000000e002";

/**
 * @param name    scenario label
 * @param actor   "admin" | "hr" | "social_worker" | "driver" | ... | null
 * @param opts    { link: boolean (default true) -- link employee A to the actor;
 *                  setup: async fn run as postgres after fixtures }
 * @param body    async fn returning a pg result, run as the acting role
 * @param expect  (result) => boolean
 */
async function scenario(ids, name, actor, opts, body, expect) {
  const role = actor === "hr" ? "social_worker" : actor;
  if (role && !ids[role]) {
    record(name, "SKIP", `no ${role} account`);
    return;
  }
  const link = opts?.link ?? true;
  await client.query(PREFLIGHT.length ? "savepoint scenario" : "begin");
  try {
    if (role) {
      // Test accounts are deactivated so they never show in a login roster;
      // current_staff_role() (0026) and hr.current_employee_id() only answer
      // for active staff, so activate the acting account inside the
      // rolled-back transaction. "hr" is the social worker with the flag.
      await client.query("update shared.staff set active = true, is_hr = $2 where id = $1", [ids[role], actor === "hr"]);
      // A real account may already own a 201 record (after the import);
      // staff_id is unique, so hand the login to the fixture for the
      // duration of this rolled-back transaction.
      await client.query("update hr.employees set staff_id = null where staff_id = $1", [ids[role]]);
    }
    await client.query(
      `insert into hr.employees (id, employee_code, staff_id, first_name, last_name, position, employment_type, status, hire_date)
       values ($1, 'T-EMP-A', $3, 'Test', 'Alpha', 'Tester', 'regular', 'active', '2024-01-15'),
              ($2, 'T-EMP-B', null, 'Test', 'Bravo', 'Tester', 'probationary', 'active', '2026-05-26')`,
      [EMP_A, EMP_B, role && link ? ids[role] : null]
    );
    await client.query(
      `insert into hr.employee_private (employee_id, sss_no, bank_account_no) values ($1, 'T-SSS-A', 'T-ACCT-A'), ($2, 'T-SSS-B', 'T-ACCT-B')`,
      [EMP_A, EMP_B]
    );
    await client.query(
      `insert into hr.compensation (employee_id, effective_from, pay_basis, basic_monthly) values ($1, '2024-01-15', 'monthly', 20000), ($2, '2026-05-26', 'monthly', 15000)`,
      [EMP_A, EMP_B]
    );
    if (opts?.setup) await opts.setup();
    await client.query("set local role authenticated");
    if (role) await client.query("select set_config('request.jwt.claims', $1, true)", [claims(ids[role])]);

    let outcome;
    try {
      const r = await body();
      outcome = { ok: true, rows: r.rowCount, data: r.rows };
    } catch (e) {
      outcome = { ok: false, code: e.code, msg: e.message };
    }
    record(name, expect(outcome) ? "PASS" : "FAIL", outcome.ok ? `ok, rows=${outcome.rows}` : `${outcome.code} ${outcome.msg}`);
  } catch (e) {
    record(name, "FAIL", `setup error: ${e.message}`);
  } finally {
    await client.query(PREFLIGHT.length ? "rollback to savepoint scenario" : "rollback");
  }
}

// --- assertion helpers -------------------------------------------------------
const denied = (r) => !r.ok && r.code === "42501";
const exclusion = (r) => !r.ok && r.code === "23P01";
const permissionDenied = (r) => !r.ok && r.code === "42501" && /permission denied/i.test(r.msg);
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

  // --- who sees which employees ------------------------------------------------
  await scenario(ids, "admin reads every employee", "admin", null, q("select id from hr.employees where employee_code like 'T-EMP-%'"), rows(2));
  await scenario(ids, "HR-flagged social worker reads every employee", "hr", null, q("select id from hr.employees where employee_code like 'T-EMP-%'"), rows(2));
  await scenario(ids, "plain social worker reads only their own record", "social_worker", null, q("select id from hr.employees where employee_code like 'T-EMP-%'"), rows(1));
  await scenario(ids, "driver reads only their own record", "driver", null, q("select id from hr.employees where employee_code like 'T-EMP-%'"), rows(1));
  await scenario(ids, "chef reads only their own record", "chef", null, q("select id from hr.employees where employee_code like 'T-EMP-%'"), rows(1));
  await scenario(ids, "board reads only their own record", "board", null, q("select id from hr.employees where employee_code like 'T-EMP-%'"), rows(1));
  await scenario(ids, "a login with no linked record reads nothing", "driver", { link: false }, q("select id from hr.employees where employee_code like 'T-EMP-%'"), rows(0));
  await scenario(ids, "no session reads nothing", null, null, q("select id from hr.employees where employee_code like 'T-EMP-%'"), rows(0));
  await scenario(
    ids,
    "a deactivated account reads nothing, even its own",
    "driver",
    { setup: () => client.query("update shared.staff set active = false where id = $1", [ids.driver]) },
    q("select id from hr.employees where employee_code like 'T-EMP-%'"),
    rows(0)
  );

  // --- private identifiers --------------------------------------------------------
  await scenario(ids, "employee reads own private record", "driver", null, q("select sss_no from hr.employee_private where employee_id = $1", [EMP_A]), rows(1));
  await scenario(ids, "employee cannot read another's private record", "driver", null, q("select sss_no from hr.employee_private where employee_id = $1", [EMP_B]), rows(0));
  await scenario(ids, "plain social worker cannot read another's private record", "social_worker", null, q("select sss_no from hr.employee_private where employee_id = $1", [EMP_B]), rows(0));
  await scenario(ids, "HR reads every private record", "hr", null, q("select sss_no from hr.employee_private where employee_id in ($1, $2)", [EMP_A, EMP_B]), rows(2));
  await scenario(ids, "employee cannot change own private record", "driver", null, q("update hr.employee_private set tin = 'X' where employee_id = $1", [EMP_A]), rows(0));

  // --- writes are HR's ------------------------------------------------------------
  await scenario(ids, "plain social worker cannot add compensation", "social_worker", null, q("insert into hr.compensation (employee_id, effective_from, pay_basis, basic_monthly) values ($1, '2026-10-01', 'monthly', 99999)", [EMP_A]), denied);
  await scenario(ids, "driver cannot raise their own pay", "driver", null, q("update hr.compensation set basic_monthly = 99999 where employee_id = $1", [EMP_A]), rows(0));
  await scenario(ids, "employee cannot edit own record", "driver", null, q("update hr.employees set position = 'CEO' where id = $1", [EMP_A]), rows(0));
  await scenario(ids, "employee cannot delete own record", "driver", null, q("delete from hr.employees where id = $1", [EMP_A]), rows(0));
  await scenario(ids, "HR adds compensation", "hr", null, q("insert into hr.compensation (employee_id, effective_from, pay_basis, basic_monthly) values ($1, '2026-10-01', 'monthly', 21000)", [EMP_A]), rows(1));
  await scenario(ids, "admin adds compensation", "admin", null, q("insert into hr.compensation (employee_id, effective_from, pay_basis, basic_monthly) values ($1, '2026-10-01', 'monthly', 21000)", [EMP_A]), rows(1));
  await scenario(ids, "HR records an employment event", "hr", null, q("insert into hr.employment_events (employee_id, kind, effective_on, employment_type) values ($1, 'regularized', '2026-11-26', 'regular')", [EMP_B]), rows(1));
  await scenario(ids, "driver cannot record an employment event", "driver", null, q("insert into hr.employment_events (employee_id, kind, effective_on) values ($1, 'regularized', '2026-11-26')", [EMP_A]), denied);
  await scenario(ids, "HR files a 201 document", "hr", null, q("insert into hr.employee_documents (employee_id, document_type_id, status) values ($1, 'nbi_clearance', 'complete')", [EMP_B]), rows(1));
  await scenario(ids, "employee cannot file own 201 document", "driver", null, q("insert into hr.employee_documents (employee_id, document_type_id, status) values ($1, 'nbi_clearance', 'complete')", [EMP_A]), denied);

  // --- effective dating (0036 triggers) --------------------------------------------
  await scenario(
    ids,
    "a new rate closes the previous one",
    "hr",
    null,
    last(
      { sql: "insert into hr.compensation (employee_id, effective_from, pay_basis, basic_monthly) values ($1, '2026-10-01', 'monthly', 21000)", params: [EMP_A] },
      { sql: "select effective_to::text as effective_to from hr.compensation where employee_id = $1 and effective_from = '2024-01-15'", params: [EMP_A] }
    ),
    value("effective_to", "2026-10-01")
  );
  await scenario(
    ids,
    "a rate cannot be back-dated behind a later one",
    "hr",
    null,
    q("insert into hr.compensation (employee_id, effective_from, pay_basis, basic_monthly) values ($1, '2023-01-01', 'monthly', 1)", [EMP_A]),
    exclusion
  );
  await scenario(
    ids,
    "a schedule needs every weekday key",
    "hr",
    null,
    q(`insert into hr.work_schedules (employee_id, effective_from, pattern) values ($1, '2026-10-01', '{"mon": null}'::jsonb)`, [EMP_A]),
    (r) => !r.ok && r.code === "23514"
  );
  await scenario(
    ids,
    "a separation event updates the employee's status and date",
    "hr",
    null,
    last(
      { sql: "insert into hr.employment_events (employee_id, kind, effective_on, separation_cause) values ($1, 'separated', '2026-09-30', 'resignation')", params: [EMP_A] },
      { sql: "select status || '|' || separation_date::text as v from hr.employees where id = $1", params: [EMP_A] }
    ),
    value("v", "resigned|2026-09-30")
  );

  // --- reference data ---------------------------------------------------------------
  await scenario(ids, "driver reads the holiday list", "driver", null, q("select id from hr.holidays where date >= '2026-01-01' and date < '2027-01-01'"), atLeast(20));
  await scenario(ids, "driver cannot add a holiday", "driver", null, q("insert into hr.holidays (date, name, kind) values ('2026-10-15', 'Test day', 'regular')"), denied);
  await scenario(ids, "HR adds a holiday", "hr", null, q("insert into hr.holidays (date, name, kind) values ('2026-10-15', 'Test day', 'regular')"), rows(1));
  await scenario(ids, "chef reads the rate tables", "chef", null, q("select id from hr.rate_tables"), atLeast(9));
  await scenario(ids, "chef cannot alter a rate table", "chef", null, q("update hr.rate_tables set status = 'in_force' where status = 'enjoined'"), rows(0));
  await scenario(ids, "board reads the leave types", "board", null, q("select id from hr.leave_types"), atLeast(8));
  await scenario(ids, "driver reads the 201 checklist", "driver", null, q("select id from hr.document_types"), atLeast(17));

  // --- pay periods, timesheets, roster (0039, 0041) --------------------------------------
  const PERIOD = "00000000-0000-4000-8000-00000000f001";
  const withPeriod = () =>
    client.query(`insert into hr.pay_periods (id, year, seq, starts_on, ends_on, pay_date) values ($1, 2031, 1, '2031-01-01', '2031-01-15', '2031-01-20')`, [PERIOD]);
  await scenario(ids, "driver reads the pay-period calendar", "driver", { setup: withPeriod }, q("select id from hr.pay_periods where id = $1", [PERIOD]), rows(1));
  await scenario(ids, "driver cannot create a pay period", "driver", null, q("insert into hr.pay_periods (year, seq, starts_on, ends_on, pay_date) values (2031, 2, '2031-01-16', '2031-01-31', '2031-02-05')"), denied);
  await scenario(ids, "HR generates a pay period", "hr", null, q("insert into hr.pay_periods (year, seq, starts_on, ends_on, pay_date) values (2031, 2, '2031-01-16', '2031-01-31', '2031-02-05')"), rows(1));
  await scenario(
    ids,
    "employee reads own period timesheet, not another's",
    "driver",
    {
      setup: async () => {
        await withPeriod();
        await client.query(`insert into hr.period_timesheets (period_id, employee_id) values ($1, $2), ($1, $3)`, [PERIOD, EMP_A, EMP_B]);
      },
    },
    q("select id from hr.period_timesheets where period_id = $1", [PERIOD]),
    rows(1)
  );
  await scenario(
    ids,
    "employee cannot approve own timesheet",
    "driver",
    {
      setup: async () => {
        await withPeriod();
        await client.query(`insert into hr.period_timesheets (period_id, employee_id) values ($1, $2)`, [PERIOD, EMP_A]);
      },
    },
    q("update hr.period_timesheets set status = 'approved', approved_at = now() where period_id = $1", [PERIOD]),
    rows(0)
  );
  await scenario(ids, "chef reads the roster view", "chef", null, q("select employee_id from hr.v_roster where employee_id in ($1, $2)", [EMP_A, EMP_B]), rows(2));
  await scenario(ids, "chef cannot write through the roster view", "chef", null, q("update hr.v_roster set position = 'CEO' where employee_id = $1", [EMP_B]), permissionDenied);
  await scenario(ids, "chef cannot delete through the roster view", "chef", null, q("delete from hr.v_roster where employee_id = $1", [EMP_B]), permissionDenied);
  await scenario(ids, "chef reads everyone's schedule overrides", "chef", { setup: () => client.query(`insert into hr.schedule_overrides (employee_id, date, is_rest_day) values ($1, '2031-01-05', true)`, [EMP_B]) }, q("select id from hr.schedule_overrides where employee_id = $1", [EMP_B]), rows(1));
  await scenario(ids, "chef cannot set an override", "chef", null, q("insert into hr.schedule_overrides (employee_id, date, is_rest_day) values ($1, '2031-01-05', true)", [EMP_A]), denied);
  await scenario(ids, "HR sets an override", "hr", null, q("insert into hr.schedule_overrides (employee_id, date, start_time, end_time) values ($1, '2031-01-05', '22:00', '06:00')", [EMP_A]), rows(1));

  // --- leave (0040) ------------------------------------------------------------------------
  const ownLeave = (status = "pending") =>
    q("insert into hr.leave_requests (employee_id, leave_type_id, starts_on, ends_on, days, status) values ($1, 'vl', '2031-02-02', '2031-02-03', 2, $2)", [EMP_A, status]);
  await scenario(ids, "employee files own pending leave request", "driver", null, ownLeave(), rows(1));
  await scenario(ids, "employee cannot file an approved request", "driver", null, ownLeave("approved"), (r) => !r.ok);
  await scenario(ids, "employee cannot file leave for someone else", "driver", null, q("insert into hr.leave_requests (employee_id, leave_type_id, starts_on, ends_on, days) values ($1, 'vl', '2031-02-02', '2031-02-03', 2)", [EMP_B]), denied);
  const LEAVE = "00000000-0000-4000-8000-00000000a001";
  const seedLeave = (status) => () =>
    client.query(
      "insert into hr.leave_requests (id, employee_id, leave_type_id, starts_on, ends_on, days, status, decided_at) values ($1, $2, 'vl', '2031-02-02', '2031-02-03', 2, $3, case when $3 in ('approved','rejected') then now() else null end)",
      [LEAVE, EMP_A, status]
    );
  await scenario(ids, "employee withdraws own pending request", "driver", { setup: seedLeave("pending") }, q("update hr.leave_requests set status = 'cancelled' where id = $1", [LEAVE]), rows(1));
  await scenario(ids, "employee cannot approve own request", "driver", { setup: seedLeave("pending") }, q("update hr.leave_requests set status = 'approved', decided_at = now() where id = $1", [LEAVE]), denied);
  await scenario(ids, "employee cannot stretch own pending request", "driver", { setup: seedLeave("pending") }, q("update hr.leave_requests set ends_on = '2031-02-10', days = 7 where id = $1", [LEAVE]), denied);
  await scenario(ids, "employee cannot withdraw an approved request", "driver", { setup: seedLeave("approved") }, q("update hr.leave_requests set status = 'cancelled' where id = $1", [LEAVE]), denied);
  await scenario(ids, "HR approves a request", "hr", { setup: seedLeave("pending") }, q("update hr.leave_requests set status = 'approved', decided_by = $2, decided_at = now() where id = $1", [LEAVE, ids.social_worker]), rows(1));
  await scenario(
    ids,
    "employee reads own requests only",
    "driver",
    {
      setup: async () => {
        await seedLeave("pending")();
        await client.query("insert into hr.leave_requests (employee_id, leave_type_id, starts_on, ends_on, days) values ($1, 'sl', '2031-03-02', '2031-03-02', 1)", [EMP_B]);
      },
    },
    q("select id from hr.leave_requests where starts_on >= '2031-01-01'"),
    rows(1)
  );
  await scenario(ids, "employee cannot adjust own balance", "driver", null, q("insert into hr.leave_adjustments (employee_id, leave_type_id, year, kind, days) values ($1, 'vl', 2031, 'opening', 10)", [EMP_A]), denied);
  await scenario(ids, "HR adjusts a balance", "hr", null, q("insert into hr.leave_adjustments (employee_id, leave_type_id, year, kind, days) values ($1, 'vl', 2031, 'opening', 10)", [EMP_A]), rows(1));

  // --- ops.time_entries after 0041 --------------------------------------------------------
  const ENTRY = "00000000-0000-4000-8000-00000000d001";
  const otherEntry = () => client.query("insert into ops.time_entries (id, staff_id, date, clock_in) values ($1, $2, '2031-01-05', '08:00')", [ENTRY, ids.admin]);
  await scenario(ids, "driver reads another's time entry (roster)", "driver", { setup: otherEntry }, q("select id from ops.time_entries where id = $1", [ENTRY]), rows(1));
  await scenario(ids, "driver cannot rewrite another's time entry", "driver", { setup: otherEntry }, q("update ops.time_entries set clock_in = '06:00' where id = $1", [ENTRY]), rows(0));
  await scenario(ids, "driver cannot delete another's time entry", "driver", { setup: otherEntry }, q("delete from ops.time_entries where id = $1", [ENTRY]), rows(0));
  await scenario(
    ids,
    "driver inserts, updates and deletes own time entry (punch route paths)",
    "driver",
    null,
    last(
      { sql: "insert into ops.time_entries (id, staff_id, date, clock_in) values ($1, $2, '2031-01-05', '08:00')", params: [ENTRY, ids.driver] },
      { sql: "update ops.time_entries set clock_out = '17:00' where id = $1", params: [ENTRY] },
      { sql: "delete from ops.time_entries where id = $1", params: [ENTRY] }
    ),
    rows(1)
  );
  await scenario(ids, "chef inserts own time entry", "chef", null, q("insert into ops.time_entries (id, staff_id, date, clock_in) values ($1, $2, '2031-01-05', '08:00')", [ENTRY, ids.chef]), rows(1));
  await scenario(ids, "HR updates another's time entry", "hr", { setup: otherEntry }, q("update ops.time_entries set clock_out = '17:00' where id = $1", [ENTRY]), rows(1));
  const seedPunch = () => client.query("insert into ops.time_punches (staff_id, punch_type, punched_at) values ($1, 'clock_in', '2031-01-05T08:00:00+08:00')", [ids.admin]);
  await scenario(ids, "HR reads every punch", "hr", { setup: seedPunch }, q("select id from ops.time_punches where punched_at >= '2031-01-01'"), rows(1));
  await scenario(ids, "plain social worker does not read others' punches", "social_worker", { setup: seedPunch }, q("select id from ops.time_punches where punched_at >= '2031-01-01'"), rows(0));

  // --- payroll (0042) ----------------------------------------------------------------------
  const RUN = "00000000-0000-4000-8000-00000000c001";
  const SLIP_A = "00000000-0000-4000-8000-00000000c0a1";
  const SLIP_B = "00000000-0000-4000-8000-00000000c0b1";
  // Seeded the way the app does it: computed with its payslips, then
  // approved by a second person (the insert guard refuses payslips on an
  // approved run, so the order matters here too).
  const seedRun = (status) => async () => {
    await withPeriod();
    await client.query(`insert into hr.payroll_runs (id, period_id, year, status, computed_by, computed_at) values ($1, $2, 2031, 'computed', $3, now())`, [RUN, PERIOD, ids.admin]);
    await client.query(
      `insert into hr.payslips (id, run_id, employee_id, period_id, pay_date, pay_basis, gross, total_deductions, net)
       values ($1, $3, $4, $5, '2031-01-20', 'monthly', 10000, 1000, 9000), ($2, $3, $6, $5, '2031-01-20', 'monthly', 7500, 500, 7000)`,
      [SLIP_A, SLIP_B, RUN, EMP_A, PERIOD, EMP_B]
    );
    if (status !== "computed") await client.query(`update hr.payroll_runs set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [RUN, ids.social_worker]);
    if (status === "paid") await client.query(`update hr.payroll_runs set status = 'paid', paid_on = '2031-01-20', paid_by = $2 where id = $1`, [RUN, ids.social_worker]);
  };
  await scenario(ids, "employee reads own settled payslip only", "driver", { setup: seedRun("approved") }, q("select id from hr.payslips where run_id = $1", [RUN]), rows(1));
  await scenario(ids, "employee cannot see a payslip while the run is still computed", "driver", { setup: seedRun("computed") }, q("select id from hr.payslips where run_id = $1", [RUN]), rows(0));
  await scenario(ids, "employee cannot read the run itself", "driver", { setup: seedRun("approved") }, q("select id from hr.payroll_runs where id = $1", [RUN]), rows(0));
  await scenario(ids, "employee acknowledges own payslip", "driver", { setup: seedRun("approved") }, q("update hr.payslips set acknowledged_at = now() where id = $1", [SLIP_A]), rows(1));
  await scenario(ids, "employee cannot change own net", "driver", { setup: seedRun("approved") }, q("update hr.payslips set net = 9500, total_deductions = 500 where id = $1", [SLIP_A]), denied);
  await scenario(ids, "employee cannot delete own payslip", "driver", { setup: seedRun("approved") }, q("delete from hr.payslips where id = $1", [SLIP_A]), rows(0));
  await scenario(ids, "chef cannot read another's payslip", "chef", { setup: seedRun("approved") }, q("select id from hr.payslips where id = $1", [SLIP_B]), rows(0));
  await scenario(ids, "HR reads every payslip in a computed run", "hr", { setup: seedRun("computed") }, q("select id from hr.payslips where run_id = $1", [RUN]), rows(2));
  await scenario(ids, "HR rewrites a payslip while the run is computed", "hr", { setup: seedRun("computed") }, q("update hr.payslips set net = 9500, total_deductions = 500 where id = $1", [SLIP_A]), rows(1));
  await scenario(ids, "HR deletes payslips of a computed run (recompute path)", "hr", { setup: seedRun("computed") }, q("delete from hr.payslips where run_id = $1", [RUN]), rows(2));
  await scenario(ids, "HR cannot delete payslips of an approved run", "hr", { setup: seedRun("approved") }, q("delete from hr.payslips where run_id = $1", [RUN]), rows(0));
  await scenario(ids, "HR cannot change an approved payslip's figures", "hr", { setup: seedRun("approved") }, q("update hr.payslips set net = 9500, total_deductions = 500 where id = $1", [SLIP_A]), denied);
  await scenario(ids, "HR links an approved payslip to its bank row reference", "hr", { setup: seedRun("approved") }, q("update hr.payslips set paid_reference = 'BDO 42' where id = $1", [SLIP_A]), rows(1));
  await scenario(ids, "HR cannot add a payslip to an approved run", "hr", { setup: seedRun("approved") }, q("insert into hr.payslips (run_id, employee_id, period_id, pay_date, pay_basis) values ($1, $2, $3, '2031-01-20', 'monthly')", [RUN, EMP_B, PERIOD]), denied);
  await scenario(
    ids,
    "the person who computed cannot approve without a waiver",
    "hr",
    { setup: seedRun("computed") },
    q("update hr.payroll_runs set status = 'approved', approved_by = computed_by, approved_at = now() where id = $1", [RUN]),
    denied
  );
  await scenario(
    ids,
    "...but can with a logged waiver",
    "hr",
    { setup: seedRun("computed") },
    q("update hr.payroll_runs set status = 'approved', approved_by = computed_by, approved_at = now(), segregation_waiver = 'single admin on duty' where id = $1", [RUN]),
    rows(1)
  );
  await scenario(ids, "a second person approves without a waiver", "hr", { setup: seedRun("computed") }, q("update hr.payroll_runs set status = 'approved', approved_by = $2, approved_at = now() where id = $1", [RUN, ids.social_worker]), rows(1));
  await scenario(ids, "an approved run cannot be cancelled", "hr", { setup: seedRun("approved") }, q("update hr.payroll_runs set status = 'cancelled', cancel_reason = 'oops' where id = $1", [RUN]), denied);
  await scenario(ids, "an approved run cannot have its totals rewritten", "hr", { setup: seedRun("approved") }, q("update hr.payroll_runs set totals = '{\"net\": 1}'::jsonb where id = $1", [RUN]), denied);
  await scenario(ids, "driver cannot create a payroll run", "driver", { setup: withPeriod }, q("insert into hr.payroll_runs (period_id, year) values ($1, 2031)", [PERIOD]), denied);
  await scenario(ids, "driver cannot add a pay item", "driver", null, q("insert into hr.pay_items (employee_id, kind, code, label, amount, is_recurring, authorized_on) values ($1, 'deduction', 'salary_advance', 'Advance', 500, true, '2031-01-01')", [EMP_A]), denied);
  await scenario(ids, "a deduction without written authorisation is refused even for HR", "hr", null, q("insert into hr.pay_items (employee_id, kind, code, label, amount, is_recurring) values ($1, 'deduction', 'salary_advance', 'Advance', 500, true)", [EMP_A]), (r) => !r.ok && r.code === "23514");
  await scenario(ids, "HR adds an authorised deduction", "hr", null, q("insert into hr.pay_items (employee_id, kind, code, label, amount, is_recurring, authorized_on) values ($1, 'deduction', 'salary_advance', 'Advance', 500, true, '2031-01-01')", [EMP_A]), rows(1));
  await scenario(
    ids,
    "employee reads own pay items only",
    "driver",
    { setup: () => client.query("insert into hr.pay_items (employee_id, kind, code, label, amount, is_recurring, authorized_on) values ($1, 'deduction', 'sss_loan', 'Loan', 500, true, '2031-01-01'), ($2, 'deduction', 'sss_loan', 'Loan', 500, true, '2031-01-01')", [EMP_A, EMP_B]) },
    q("select id from hr.pay_items where employee_id in ($1, $2)", [EMP_A, EMP_B]),
    rows(1)
  );
  await scenario(ids, "driver cannot set own YTD opening", "driver", null, q("insert into hr.ytd_openings (employee_id, year, as_of, tax_withheld) values ($1, 2031, '2031-06-30', 0)", [EMP_A]), denied);
  await scenario(ids, "HR sets a YTD opening", "hr", null, q("insert into hr.ytd_openings (employee_id, year, as_of, tax_withheld) values ($1, 2031, '2031-06-30', 1234.56)", [EMP_A]), rows(1));

  // --- compliance (0043) -------------------------------------------------------------------
  const ITEM = "00000000-0000-4000-8000-00000000e001";
  const seedItem = () => client.query(`insert into hr.compliance_items (id, code, agency, name, category, frequency, due_rule, applies, active) values ($1, 't_item', 'TEST', 'Test item', 'employment', 'monthly', '{"kind": "day_of_month", "day": 10}', 'conditional', false)`, [ITEM]);
  await scenario(ids, "driver reads the compliance items", "driver", { setup: seedItem }, q("select id from hr.compliance_items where id = $1", [ITEM]), rows(1));
  await scenario(ids, "driver cannot switch a conditional item on", "driver", { setup: seedItem }, q("update hr.compliance_items set active = true where id = $1", [ITEM]), rows(0));
  await scenario(ids, "HR switches a conditional item on", "hr", { setup: seedItem }, q("update hr.compliance_items set active = true where id = $1", [ITEM]), rows(1));
  await scenario(ids, "driver cannot read filings", "driver", { setup: async () => { await seedItem(); await client.query(`insert into hr.compliance_filings (item_id, period_key, due_on, status) values ($1, '2031-01', '2031-02-10', 'in_progress')`, [ITEM]); } }, q("select id from hr.compliance_filings where item_id = $1", [ITEM]), rows(0));
  await scenario(ids, "driver cannot record a filing", "driver", { setup: seedItem }, q("insert into hr.compliance_filings (item_id, period_key, due_on, status) values ($1, '2031-01', '2031-02-10', 'in_progress')", [ITEM]), denied);
  await scenario(ids, "HR records a filing with its reference", "hr", { setup: seedItem }, q("insert into hr.compliance_filings (item_id, period_key, due_on, status, filed_on, reference_no) values ($1, '2031-01', '2031-02-10', 'filed', '2031-02-09', 'PRN 123')", [ITEM]), rows(1));
  await scenario(ids, "a filing marked filed needs a date", "hr", { setup: seedItem }, q("insert into hr.compliance_filings (item_id, period_key, due_on, status) values ($1, '2031-01', '2031-02-10', 'filed')", [ITEM]), (r) => !r.ok && r.code === "23514");
  await scenario(ids, "driver cannot set the compliance settings", "driver", null, q("update shared.app_settings set compliance_pen_last_digit = 7 where id = true"), rows(0));
  // --- the Compliances menu (0044): finance records filings, HR keeps the obligations ---------
  const seedFiling = async () => { await seedItem(); await client.query(`insert into hr.compliance_filings (item_id, period_key, due_on, status) values ($1, '2031-01', '2031-02-10', 'in_progress')`, [ITEM]); };
  await scenario(ids, "finance reads filings", "finance", { setup: seedFiling }, q("select id from hr.compliance_filings where item_id = $1", [ITEM]), rows(1));
  await scenario(ids, "finance records a filing", "finance", { setup: seedItem }, q("insert into hr.compliance_filings (item_id, period_key, due_on, status, filed_on, reference_no) values ($1, '2031-02', '2031-03-10', 'filed', '2031-03-01', 'PRN 456')", [ITEM]), rows(1));
  await scenario(ids, "finance updates a filing", "finance", { setup: seedFiling }, q("update hr.compliance_filings set notes = 'paid' where item_id = $1", [ITEM]), rows(1));
  await scenario(ids, "finance cannot delete a filing", "finance", { setup: seedFiling }, q("delete from hr.compliance_filings where item_id = $1", [ITEM]), rows(0));
  await scenario(ids, "finance cannot edit an obligation", "finance", { setup: seedItem }, q("update hr.compliance_items set active = true where id = $1", [ITEM]), rows(0));
  await scenario(ids, "finance cannot add an obligation", "finance", null, q("insert into hr.compliance_items (code, agency, name, category, frequency) values ('t_fin', 'TEST', 'Finance item', 'corporate', 'annual')"), denied);
  await scenario(ids, "chef cannot record a filing", "chef", { setup: seedItem }, q("insert into hr.compliance_filings (item_id, period_key, due_on, status) values ($1, '2031-01', '2031-02-10', 'in_progress')", [ITEM]), denied);
  await scenario(ids, "board cannot read filings", "board", { setup: seedFiling }, q("select id from hr.compliance_filings where item_id = $1", [ITEM]), rows(0));
  await scenario(ids, "HR adds a social-welfare obligation with a published date", "hr", null, q(`insert into hr.compliance_items (code, agency, name, category, frequency, due_rule, due_overrides) values ('t_dswd', 'DSWD', 'Test DSWD', 'social_welfare', 'annual', '{"kind": "fixed", "month": 3, "day": 31, "yearOffset": 1}', '{"2030": "2031-04-15"}') returning id`), rows(1));
  await scenario(ids, "an override must be an object", "hr", null, q(`insert into hr.compliance_items (code, agency, name, category, frequency, due_overrides) values ('t_bad', 'X', 'Bad', 'corporate', 'annual', '[]')`), (r) => !r.ok && r.code === "23514");
  await scenario(ids, "the seven verified obligations are seeded", "admin", null, q("select count(*)::int as n from hr.compliance_items where code in ('bir_2316_submit', 'dole_aedr', 'dole_amr', 'dswd_accomplishment', 'dswd_financial', 'dswd_license', 'dswd_solicitation')"), value("n", 7));
  await scenario(ids, "the SEC AFS carries MC 9-2026's date for FY2025", "admin", null, q("select due_overrides->>'2025' as d from hr.compliance_items where code = 'sec_afs'"), value("d", "2026-05-29"));
  await scenario(ids, "lead days default to 10", "admin", null, q("select compliance_lead_days as n from shared.app_settings where id = true"), value("n", 10));
  await scenario(
    ids,
    "13th-month payslip is visible to the employee only once settled",
    "driver",
    {
      setup: async () => {
        await client.query(`insert into hr.payroll_runs (id, kind, year, status, computed_by, computed_at, label) values ($1, 'thirteenth_month', 2031, 'computed', $2, now(), '13th 2031')`, [RUN, ids.admin]);
        await client.query(`insert into hr.payslips (id, run_id, employee_id, pay_date, pay_basis, gross, total_deductions, net, non_taxable) values ($1, $2, $3, '2031-12-15', 'monthly', 5000, 0, 5000, 5000)`, [SLIP_A, RUN, EMP_A]);
      },
    },
    q("select id from hr.payslips where id = $1", [SLIP_A]),
    rows(0)
  );

  // --- the file library (0045, shared.files) ------------------------------------------------
  const FILE = (n) => `00000000-0000-4000-8000-0000000f000${n}`;
  const fileRow = (id, module, recordType, recordId, by, status = "ready", subKey = null) =>
    client.query(
      `insert into shared.files (id, module, record_type, record_id, sub_key, object_key, folder, file_name, content_type, size_bytes, status, uploaded_by)
       values ($1::uuid, $2, $3, $4::uuid, $5, 'test/' || $1::text, 'Test', 'f.pdf', 'application/pdf', 10, $6, $7::uuid)`,
      [id, module, recordType, recordId, subKey, status, by]
    );
  const seedFiles = async () => {
    await fileRow(FILE(1), "hr", "employee", EMP_A, ids.admin);
    await fileRow(FILE(2), "hr", "employee", EMP_B, ids.admin);
    await seedItem();
    await fileRow(FILE(3), "compliance", "compliance_item", ITEM, ids.admin, "ready", "2031-01");
    await fileRow(FILE(4), "patients", "patient", "00000000-0000-4000-8000-0000000fa001", ids.admin);
    await fileRow(FILE(5), "donors", "donor", "00000000-0000-4000-8000-0000000fd001", ids.admin);
    await fileRow(FILE(6), "finance", "bank_statement_import", "00000000-0000-4000-8000-0000000fb001", ids.admin);
    await fileRow(FILE(7), "hr", "employee", EMP_A, ids.admin, "pending");
  };
  const seen = (...keys) => (r) => r.ok && JSON.stringify(r.data.map((x) => x.k)) === JSON.stringify(keys);
  await scenario(ids, "driver (linked to EMP-A) reads only their own ready 201 file", "driver", { setup: seedFiles }, q("select module || ':' || right(id::text, 1) as k from shared.files where object_key like 'test/%' order by 1"), seen("hr:1"));
  await scenario(ids, "HR (also a social worker) reads HR, compliance and patient files, not another uploader's pending one", "hr", { link: false, setup: seedFiles }, q("select module || ':' || right(id::text, 1) as k from shared.files where object_key like 'test/%' order by 1"), seen("compliance:3", "hr:1", "hr:2", "patients:4"));
  await scenario(ids, "admin reads every ready file and their own pending one", "admin", { setup: seedFiles }, q("select count(*)::int as n from shared.files where object_key like 'test/%'"), value("n", 7));
  await scenario(ids, "finance reads compliance, donor and finance files only", "finance", { link: false, setup: seedFiles }, q("select module || ':' || right(id::text, 1) as k from shared.files where object_key like 'test/%' order by 1"), seen("compliance:3", "donors:5", "finance:6"));
  await scenario(ids, "social worker reads patient files only", "social_worker", { link: false, setup: seedFiles }, q("select module || ':' || right(id::text, 1) as k from shared.files where object_key like 'test/%' order by 1"), seen("patients:4"));
  await scenario(ids, "board reads finance files only", "board", { link: false, setup: seedFiles }, q("select module || ':' || right(id::text, 1) as k from shared.files where object_key like 'test/%' order by 1"), seen("finance:6"));
  await scenario(ids, "chef sees no files", "chef", { link: false, setup: seedFiles }, q("select count(*)::int as n from shared.files where object_key like 'test/%'"), value("n", 0));
  await scenario(ids, "HR adds a 201 file", "hr", null, q("insert into shared.files (module, record_type, record_id, object_key, folder, file_name, content_type, uploaded_by) values ('hr', 'employee', $1, 'test/new-1', 'Test', 'a.pdf', 'application/pdf', $2)", [EMP_A, ids.social_worker]), rows(1));
  await scenario(ids, "driver cannot add a 201 file, even their own", "driver", null, q("insert into shared.files (module, record_type, record_id, object_key, folder, file_name, content_type, uploaded_by) values ('hr', 'employee', $1, 'test/new-2', 'Test', 'a.pdf', 'application/pdf', $2)", [EMP_A, ids.driver]), denied);
  await scenario(ids, "a spoofed uploaded_by is refused", "hr", null, q("insert into shared.files (module, record_type, record_id, object_key, folder, file_name, content_type, uploaded_by) values ('hr', 'employee', $1, 'test/new-3', 'Test', 'a.pdf', 'application/pdf', $2)", [EMP_A, ids.admin]), denied);
  await scenario(ids, "finance adds a compliance file", "finance", { setup: seedItem }, q("insert into shared.files (module, record_type, record_id, sub_key, object_key, folder, file_name, content_type, uploaded_by) values ('compliance', 'compliance_item', $1, '2031-01', 'test/new-4', 'Test', 'a.pdf', 'application/pdf', $2)", [ITEM, ids.finance]), rows(1));
  await scenario(ids, "finance cannot delete a compliance file", "finance", { setup: seedFiles }, q("delete from shared.files where id = $1", [FILE(3)]), rows(0));
  await scenario(ids, "HR deletes a compliance file", "hr", { setup: seedFiles }, q("delete from shared.files where id = $1", [FILE(3)]), rows(1));
  await scenario(ids, "board cannot add a finance file", "board", null, q("insert into shared.files (module, record_type, record_id, object_key, folder, file_name, content_type, uploaded_by) values ('finance', 'bank_statement_import', '00000000-0000-4000-8000-0000000fb001', 'test/new-5', 'Test', 'a.csv', 'text/csv', $1)", [ids.board]), denied);
  await scenario(ids, "social worker cannot read a donor file by id", "social_worker", { setup: seedFiles }, q("select id from shared.files where id = $1", [FILE(5)]), rows(0));
  await scenario(ids, "the uploader confirms their own pending file", "admin", { setup: seedFiles }, q("update shared.files set status = 'ready', size_bytes = 99 where id = $1", [FILE(7)]), rows(1));
  await scenario(ids, "a module must match its record type", "admin", null, q("insert into shared.files (module, record_type, record_id, object_key, folder, file_name, content_type, uploaded_by) values ('hr', 'patient', $1, 'test/new-6', 'Test', 'a.pdf', 'application/pdf', $2)", [EMP_A, ids.admin]), (r) => !r.ok && r.code === "23514");

  // --- the flag itself ----------------------------------------------------------------
  await scenario(ids, "a person cannot flag themselves as HR", "driver", null, q("update shared.staff set is_hr = true where id = $1", [ids.driver]), denied);
  await scenario(ids, "hr.is_hr_staff() is true for an admin", "admin", null, q("select hr.is_hr_staff() as v"), value("v", true));
  await scenario(ids, "hr.is_hr_staff() is true for the flagged social worker", "hr", null, q("select hr.is_hr_staff() as v"), value("v", true));
  await scenario(ids, "hr.is_hr_staff() is false for a plain social worker", "social_worker", null, q("select hr.is_hr_staff() as v"), value("v", false));
  await scenario(ids, "hr.is_hr_staff() is false for finance", "finance", null, q("select hr.is_hr_staff() as v"), value("v", false));

  // --- structural checks (as postgres) --------------------------------------------------
  const published = (await client.query(
    `select coalesce(string_agg(tablename, ',' order by tablename), '') as t from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'hr'`
  )).rows[0].t.split(",");
  record("employee_private is not in the realtime publication", published.includes("employee_private") ? "FAIL" : "PASS", published.join(","));
  const { rows: sharedPub } = await client.query(`select coalesce(string_agg(tablename, ',' order by tablename), '') as t from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'shared'`);
  record("shared.files is in the realtime publication", sharedPub[0].t.split(",").includes("files") ? "PASS" : "FAIL");
  const { rows: filesRls } = await client.query("select relrowsecurity as on from pg_class where oid = 'shared.files'::regclass");
  record("RLS is on for shared.files", filesRls[0]?.on ? "PASS" : "FAIL");
  for (const t of ["employees", "compensation", "work_schedules", "holidays", "rate_tables", "leave_types", "pay_periods", "period_timesheets", "schedule_overrides", "leave_requests", "leave_adjustments", "pay_items", "payroll_runs", "payslips", "ytd_openings", "compliance_items", "compliance_filings"]) {
    record(`${t} is in the realtime publication`, published.includes(t) ? "PASS" : "FAIL");
  }
  const unguarded = (await client.query(
    `select coalesce(string_agg(c.relname, ',' order by c.relname), '(none)') as t
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'hr' and c.relkind = 'r' and not c.relrowsecurity`
  )).rows[0].t;
  record("every hr table has RLS enabled", unguarded === "(none)" ? "PASS" : "FAIL", unguarded);
  const schemas = (await client.query(`select setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator'`)).rows[0]?.setconfig?.join(" ") ?? "";
  record("PostgREST serves the hr schema", /pgrst\.db_schemas=.*\bhr\b/.test(schemas) ? "PASS" : "FAIL", schemas.slice(0, 60));
  const retired = (await client.query(`select coalesce(string_agg(tablename, ','), '(none)') as t from pg_tables where schemaname = 'ops' and tablename in ('shifts', 'timesheet_approvals')`)).rows[0].t;
  record("ops.shifts and ops.timesheet_approvals are gone", retired === "(none)" ? "PASS" : "FAIL", retired);
  const viewGrants = (await client.query(`select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(none)') as t from information_schema.table_privileges where table_schema = 'hr' and table_name = 'v_roster' and grantee = 'authenticated'`)).rows[0].t;
  record("hr.v_roster is select-only for authenticated", viewGrants === "SELECT" ? "PASS" : "FAIL", viewGrants);
  const writableViews = (await client.query(`select coalesce(string_agg(table_name, ','), '(none)') as t from information_schema.table_privileges where table_schema = 'hr' and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE') and table_name in (select table_name from information_schema.views where table_schema = 'hr')`)).rows[0].t;
  record("no hr view is writable by authenticated", writableViews === "(none)" ? "PASS" : "FAIL", writableViews);
  const noDelete = (await client.query(`select count(*)::int as n from pg_policies where schemaname = 'hr' and tablename = 'payslips' and (cmd = 'DELETE' or cmd = 'ALL') and policyname <> 'hr delete draft payslips'`)).rows[0].n;
  record("payslips have no blanket delete or ALL policy", noDelete === 0 ? "PASS" : "FAIL", String(noDelete));
  const blanket = (await client.query(`select count(*)::int as n from pg_policies where schemaname = 'ops' and tablename = 'time_entries' and policyname = 'lafopsys staff full access'`)).rows[0].n;
  record("no blanket policy on ops.time_entries", blanket === 0 ? "PASS" : "FAIL");

  console.table(results);
  const failed = results.filter((r) => r.result === "FAIL").length;
  const skipped = results.filter((r) => r.result === "SKIP").length;
  console.log(`${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
  if (PREFLIGHT.length) {
    await client.query("rollback");
    console.log("pre-flight rolled back");
  }
  await client.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await client.end().catch(() => {});
  process.exit(1);
});
