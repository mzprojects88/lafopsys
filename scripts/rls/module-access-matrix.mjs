// Proves shared.module_access and the module policies of 0050 against the
// live database: the seed keeps what each role could do before, and changing
// a level in the grid changes what the database allows. One scenario per
// transaction, every transaction rolled back. Same harness as
// scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1 acknowledges
// that lafopsys has one database.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/module-access-matrix.mjs
// Pre-flight (before 0049/0050 are applied, one rolled-back transaction):
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/module-access-matrix.mjs supabase/migrations/0049_check_in.sql supabase/migrations/0050_module_access.sql
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

const ROLES = ["admin", "social_worker", "house_staff", "driver", "finance", "board", "volunteer", "chef"];
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

// Fixtures: one patient (for reads and appointment inserts) and B1 unlocked.
const PT = "00000000-0000-4000-8000-0000000000d1";
const seedPatient = async () => {
  await client.query("update ops.units set status = 'available', lock_reason = null where id = 'unit-B1'");
  await client.query(
    `insert into ops.patients (id, patient_number, first_name, last_name, sex, status, admitted_at)
     values ($1, 'RLSTEST-MA1', 'Access', 'Test', 'F', 'ongoing', current_date)`,
    [PT]
  );
};
const setLevel = (role, module, level) =>
  client.query(
    `insert into shared.module_access (role, module, level) values ($1, $2, $3)
     on conflict (role, module) do update set level = excluded.level`,
    [role, module, level]
  );
const withPatient = (extra) => ({
  setup: async () => {
    await seedPatient();
    if (extra) await extra();
  },
});
const insertAppt = `insert into ops.appointments (patient_id, date, time, clinic, purpose) values ('${PT}', current_date + 1, '08:00', 'NCH', 'Test')`;
const readPatient = `select id from ops.patients where id = '${PT}'`;
const checkIn = `select ops.check_in(p_rules_discussed => true, p_unit_id => 'unit-B1', p_check_in_at => (now() at time zone 'Asia/Manila')::date, p_patient_id => '${PT}')`;
const lock = "update ops.units set status = 'maintenance', lock_reason = 'Broken slat' where id = 'unit-B1'";

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

  // --- the seed keeps today's behaviour ----------------------------------------
  await scenario(ids, "social worker reads a patient", "social_worker", withPatient(), q(readPatient), rows(1));
  await scenario(ids, "social worker books an appointment", "social_worker", withPatient(), q(insertAppt), rows(1));
  await scenario(ids, "social worker checks a patient in", "social_worker", withPatient(), q(checkIn), rows(1));
  await scenario(ids, "social worker locks a bed", "social_worker", null, q(lock), rows(1));
  await scenario(ids, "driver reads a patient through House Operations", "driver", withPatient(), q(readPatient), rows(1));
  await scenario(ids, "house staff reads a patient through House Operations", "house_staff", withPatient(), q(readPatient), rows(1));
  await scenario(ids, "driver cannot book an appointment", "driver", withPatient(), q(insertAppt), denied);
  await scenario(ids, "driver cannot check a patient in", "driver", withPatient(), q(checkIn), denied);
  // A view-only session's UPDATE matches no row (RLS filters it): refused, silently.
  await scenario(ids, "house staff can no longer lock a bed", "house_staff", null, q(lock), rows(0));
  await scenario(ids, "volunteer reads no patients", "volunteer", withPatient(), q(readPatient), rows(0));
  await scenario(ids, "board reads no patients", "board", withPatient(), q(readPatient), rows(0));
  await scenario(ids, "house staff reads no house sheet", "house_staff", null, q("select id from ops.house_sheet_people"), rows(0));
  await scenario(ids, "social worker reads the house sheet", "social_worker", null, q("select id from ops.house_sheet_people"), atLeast(1));
  await scenario(ids, "volunteer still reads the diagnosis list", "volunteer", null, q("select id from ops.diagnoses"), atLeast(1));
  await scenario(ids, "social worker cannot add a diagnosis", "social_worker", null,
    q("insert into ops.diagnoses (id, name, category) values ('dx-rlstest', 'Test', 'other')"), denied);
  await scenario(ids, "board reads bank transactions", "board", null, q("select id from ops.bank_transactions limit 1"), atLeast(0));
  await scenario(ids, "board cannot write a month note", "board", null,
    q("insert into ops.finance_month_notes (month, drivers) values ('2020-01', 'x')"), denied);
  await scenario(ids, "chef still reads donors (laf-inventory)", "chef", null, q("select id from ops.donors limit 1"), rows(1));
  await scenario(ids, "house staff cannot add a calendar event", "house_staff", null,
    q("insert into ops.calendar_events (date, title) values (current_date, 'x')"), denied);
  await scenario(ids, "board cannot upload a patient file", "board", null, q("select shared.file_write_allowed('patients') as ok"), value("ok", false));
  await scenario(ids, "social worker can upload a patient file", "social_worker", null, q("select shared.file_write_allowed('patients') as ok"), value("ok", true));

  // --- the grid changes what the database allows --------------------------------
  await scenario(ids, "social worker set to View reads but cannot write", "social_worker",
    withPatient(() => setLevel("social_worker", "patients", "view")), q(readPatient), rows(1));
  await scenario(ids, "social worker set to View cannot book", "social_worker",
    withPatient(() => setLevel("social_worker", "patients", "view")), q(insertAppt), denied);
  await scenario(ids, "social worker set to View cannot check in", "social_worker",
    withPatient(() => setLevel("social_worker", "patients", "view")), q(checkIn), denied);
  await scenario(ids, "social worker set to View cannot lock a bed", "social_worker",
    { setup: () => setLevel("social_worker", "patients", "view") }, q(lock), rows(0));
  // Resident data is readable from Patients OR House Operations, so both go.
  await scenario(ids, "social worker set to None on both reads nothing", "social_worker",
    withPatient(async () => {
      await setLevel("social_worker", "patients", "none");
      await setLevel("social_worker", "house_ops", "none");
    }), q(readPatient), rows(0));
  await scenario(ids, "social worker with only House Operations still reads residents", "social_worker",
    withPatient(() => setLevel("social_worker", "patients", "none")), q(readPatient), rows(1));
  await scenario(ids, "driver given Patients edit can book", "driver",
    withPatient(() => setLevel("driver", "patients", "edit")), q(insertAppt), rows(1));
  await scenario(ids, "house staff given Calendar edit adds an event", "house_staff",
    { setup: () => setLevel("house_staff", "calendar", "edit") },
    q("insert into ops.calendar_events (date, title) values (current_date, 'x')"), rows(1));

  // --- the grid itself -------------------------------------------------------------
  await scenario(ids, "admin changes a level and is stamped", "admin", null,
    q("update shared.module_access set level = 'view' where role = 'driver' and module = 'house_ops' returning updated_by"),
    (r) => value("updated_by", ids.admin)(r));
  await scenario(ids, "admin cannot demote admin", "admin", null,
    q("update shared.module_access set level = 'view' where role = 'admin' and module = 'patients'"), checkFailed);
  await scenario(ids, "social worker cannot change the grid", "social_worker", null,
    q("update shared.module_access set level = 'edit' where role = 'social_worker' and module = 'settings'"), rows(0));
  await scenario(ids, "social worker cannot grant itself a module", "social_worker", null,
    q("insert into shared.module_access (role, module, level) values ('social_worker', 'finance', 'edit')"), denied);
  await scenario(ids, "Settings cannot be opened to another role", "admin", null,
    q("insert into shared.module_access (role, module, level) values ('social_worker', 'settings', 'view')"), checkFailed);
  await scenario(ids, "an unknown module is refused", "admin", null,
    q("insert into shared.module_access (role, module, level) values ('driver', 'payroll', 'view')"), checkFailed);

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
