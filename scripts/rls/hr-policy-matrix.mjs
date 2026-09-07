// Proves the hr schema's row-level security (migrations 0035-0037) against
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
import { Client } from "pg";

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
  await client.query("begin");
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
    await client.query("rollback");
  }
}

// --- assertion helpers -------------------------------------------------------
const denied = (r) => !r.ok && r.code === "42501";
const exclusion = (r) => !r.ok && r.code === "23P01";
const rows = (n) => (r) => r.ok && r.rows === n;
const atLeast = (n) => (r) => r.ok && r.rows >= n;
const value = (field, v) => (r) => r.ok && r.rows === 1 && r.data[0][field] === v;

const q = (sql, params) => () => client.query(sql, params);
const last = (...steps) => async () => {
  let r;
  for (const s of steps) r = await client.query(s.sql, s.params);
  return r;
};

async function main() {
  await client.connect();
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
  for (const t of ["employees", "compensation", "work_schedules", "holidays", "rate_tables", "leave_types"]) {
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

  console.table(results);
  const failed = results.filter((r) => r.result === "FAIL").length;
  const skipped = results.filter((r) => r.result === "SKIP").length;
  console.log(`${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
  await client.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await client.end().catch(() => {});
  process.exit(1);
});
