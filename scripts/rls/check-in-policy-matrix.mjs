// Proves ops.check_in (0049) against the live database: who may check a
// patient in, and every rule the function enforces -- one scenario per
// transaction, every transaction rolled back, nothing persists. Same harness
// as scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1 acknowledges
// that lafopsys has one database.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/check-in-policy-matrix.mjs
// Pre-flight (before 0049 is applied, all in one rolled-back transaction):
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/check-in-policy-matrix.mjs supabase/migrations/0049_check_in.sql
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

// Fixtures: an existing patient with a carer, a second patient with a carer,
// an approved referral with a diagnosis, and B1 free and unlocked.
const P1 = "00000000-0000-4000-8000-0000000000c1";
const C1 = "00000000-0000-4000-8000-0000000000c2";
const P2 = "00000000-0000-4000-8000-0000000000c3";
const C2 = "00000000-0000-4000-8000-0000000000c4";
const REF = "00000000-0000-4000-8000-0000000000c5";
const seed = async () => {
  await client.query("update ops.units set status = 'available', lock_reason = null where id = 'unit-B1'");
  await client.query(
    `insert into ops.patients (id, patient_number, first_name, last_name, sex, status, admitted_at) values
     ($1, 'RLSTEST-CI1', 'Returning', 'Family', 'F', 'check_up', '2026-01-10'),
     ($2, 'RLSTEST-CI2', 'Other', 'Child', 'M', 'ongoing', '2026-01-10')`,
    [P1, P2]
  );
  await client.query(
    `insert into ops.carers (id, patient_id, name, relationship, effective_from) values
     ($1, $2, 'Mama One', 'Mother', '2026-01-10'), ($3, $4, 'Papa Two', 'Father', '2026-01-10')`,
    [C1, P1, C2, P2]
  );
  const dx = await client.query("select id from ops.diagnoses limit 1");
  await client.query(
    `insert into ops.referrals (id, patient_name, referring_person, department, urgency, status,
       patient_first_name, patient_last_name, patient_sex, carer_name, carer_relationship, carer_mobile)
     values ($1, 'New Kid', 'Dr. Test', 'Pediatric Oncology', 'routine', 'approved', 'New', 'Kid', 'M', 'Ate Kid', 'Aunt', '09170000000')`,
    [REF]
  );
  await client.query("insert into ops.referral_diagnoses (referral_id, diagnosis_id) values ($1, $2)", [REF, dx.rows[0].id]);
};
const withSeed = (extra) => ({
  setup: async () => {
    await seed();
    if (extra) await extra();
  },
});
const TODAY = "(now() at time zone 'Asia/Manila')::date";
const ciPatient = (patient, extra = "") =>
  `select ops.check_in(p_unit_id => 'unit-B1', p_check_in_at => ${TODAY}, p_patient_id => '${patient}'${extra}) as r`;
const ciReferral = (extra = "") =>
  `select ops.check_in(p_unit_id => 'unit-B1', p_check_in_at => ${TODAY}, p_referral_id => '${REF}'${extra}) as r`;
const badInput = (r) => !r.ok && r.code === "22023";
const notFound = (r) => !r.ok && r.code === "P0002";

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

  // --- who ---------------------------------------------------------------------
  await scenario(ids, "social worker checks in a patient on file", "social_worker", withSeed(),
    last({ sql: ciPatient(P1, `, p_carer_id => '${C1}'`) },
      { sql: "select count(*)::int as n from ops.stays where patient_id = $1 and status = 'in_house' and bed_position_id = 'unit-B1-A' and carer_id = $2", params: [P1, C1] }),
    value("n", 1));
  await scenario(ids, "admin checks in a patient on file", "admin", withSeed(), q(ciPatient(P1)), rows(1));
  await scenario(ids, "house staff cannot check in", "house_staff", withSeed(), q(ciPatient(P1)), denied);
  await scenario(ids, "driver cannot check in", "driver", withSeed(), q(ciPatient(P1)), denied);
  await scenario(ids, "no session cannot check in", null, withSeed(), q(ciPatient(P1)), denied);

  // --- referral path -----------------------------------------------------------
  await scenario(ids, "an approved referral becomes the next-numbered patient", "social_worker", withSeed(),
    last({ sql: ciReferral() },
      { sql: `select (p.patient_number = (select (max(patient_number::int))::text from ops.patients where patient_number ~ '^[0-9]+$'))
                 and r.status = 'admitted' and p.status = 'ongoing'
                 and exists (select 1 from ops.patient_diagnoses d where d.patient_id = p.id)
                 and exists (select 1 from ops.carers c where c.patient_id = p.id and c.name = 'Ate Kid' and c.relationship = 'Aunt')
                 and exists (select 1 from ops.stays s where s.patient_id = p.id and s.status = 'in_house') as ok
               from ops.referrals r join ops.patients p on p.id = r.admitted_patient_id where r.id = $1`, params: [REF] }),
    value("ok", true));
  await scenario(ids, "a referral for someone on file makes no second patient", "social_worker", withSeed(),
    last({ sql: ciReferral(`, p_patient_id => '${P1}'`) },
      { sql: `select (select admitted_patient_id from ops.referrals where id = $1) = $2
                 and not exists (select 1 from ops.patients where first_name = 'New' and last_name = 'Kid') as ok`, params: [REF, P1] }),
    value("ok", true));
  await scenario(ids, "a submitted referral cannot be admitted", "social_worker",
    withSeed(() => client.query("update ops.referrals set status = 'submitted' where id = $1", [REF])), q(ciReferral()), checkFailed);
  await scenario(ids, "an admitted referral cannot be admitted twice", "social_worker",
    withSeed(() => client.query("update ops.referrals set status = 'admitted' where id = $1", [REF])), q(ciReferral()), checkFailed);
  await scenario(ids, "neither patient nor referral is refused", "social_worker", withSeed(),
    q(`select ops.check_in(p_unit_id => 'unit-B1', p_check_in_at => ${TODAY})`), badInput);

  // --- the bed -----------------------------------------------------------------
  await scenario(ids, "a taken bed is refused", "social_worker",
    withSeed(() => client.query("insert into ops.stays (patient_id, bed_position_id, check_in_at, status) values ($1, 'unit-B1-A', current_date, 'in_house')", [P2])),
    q(ciPatient(P1)), duplicate);
  await scenario(ids, "a locked bed is refused", "social_worker",
    withSeed(() => client.query("update ops.units set status = 'maintenance', lock_reason = 'Broken slat' where id = 'unit-B1'")),
    q(ciPatient(P1)), checkFailed);
  await scenario(ids, "an unknown bed is refused", "social_worker", withSeed(),
    q(`select ops.check_in(p_unit_id => 'unit-B999', p_check_in_at => ${TODAY}, p_patient_id => '${P1}')`), notFound);

  // --- the patient -------------------------------------------------------------
  await scenario(ids, "a patient already in the house is refused", "social_worker",
    withSeed(() => client.query("insert into ops.stays (patient_id, bed_position_id, check_in_at, status) values ($1, 'unit-B2-A', current_date, 'in_house')", [P1])),
    q(ciPatient(P1)), duplicate);
  await scenario(ids, "a deceased patient is refused", "social_worker",
    withSeed(() => client.query("update ops.patients set status = 'expired' where id = $1", [P1])), q(ciPatient(P1)), checkFailed);
  await scenario(ids, "another patient's carer is refused", "social_worker", withSeed(), q(ciPatient(P1, `, p_carer_id => '${C2}'`)), checkFailed);
  await scenario(ids, "a new carer needs a relationship", "social_worker", withSeed(), q(ciPatient(P1, ", p_carer_name => 'Lola'")), checkFailed);

  // --- dates and the appointment ------------------------------------------------
  await scenario(ids, "a future check-in is refused", "social_worker", withSeed(),
    q(`select ops.check_in(p_unit_id => 'unit-B1', p_check_in_at => ${TODAY} + 1, p_patient_id => '${P1}')`), badInput);
  await scenario(ids, "a family already in the house keeps its arrival day", "social_worker", withSeed(),
    last({ sql: `select ops.check_in(p_unit_id => 'unit-B1', p_check_in_at => ${TODAY} - 12, p_patient_id => '${P1}', p_expected_checkout_at => ${TODAY} + 5)` },
      { sql: `select check_in_at = ${TODAY} - 12 as ok from ops.stays where patient_id = $1`, params: [P1] }),
    value("ok", true));
  await scenario(ids, "expected check-out before check-in is refused", "social_worker", withSeed(),
    q(ciPatient(P1, `, p_expected_checkout_at => ${TODAY} - 1`)), badInput);
  await scenario(ids, "the next appointment lands on the manifest", "social_worker", withSeed(),
    last({ sql: ciPatient(P1, `, p_appt_date => ${TODAY} + 1, p_appt_time => '07:30', p_appt_clinic => 'NCH Onco', p_appt_needs_transport => true`) },
      { sql: "select needs_transport and time = '07:30' as ok from ops.appointments where patient_id = $1", params: [P1] }),
    value("ok", true));
  await scenario(ids, "an appointment needs a clinic", "social_worker", withSeed(), q(ciPatient(P1, `, p_appt_date => ${TODAY} + 1`)), checkFailed);

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
