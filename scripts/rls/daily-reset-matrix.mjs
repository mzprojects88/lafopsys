// Proves 0051 (admission from NCH's Occupancy Tracker, nightly beds, the
// sheet's appointments) against the live database, one scenario per
// transaction, every transaction rolled back. Same harness as
// scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1 acknowledges
// that lafopsys has one database.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/daily-reset-matrix.mjs
// Pre-flight (before 0049-0051 are applied, one rolled-back transaction):
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/daily-reset-matrix.mjs supabase/migrations/0049_check_in.sql supabase/migrations/0050_module_access.sql supabase/migrations/0051_sheet_admission.sql
import { pgUrl } from "../lib/db-url.mjs";
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
const client = new Client({
  connectionString: pgUrl(password),
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
const duplicate = (r) => !r.ok && r.code === "23505";
const rows = (n) => (r) => r.ok && r.rows === n;
const value = (field, v) => (r) => r.ok && r.rows === 1 && r.data[0][field] === v;

const q = (sql, params) => () => client.query(sql, params);
const last = (...steps) => async () => {
  let r;
  for (const s of steps) r = await client.query(s.sql, s.params);
  return r;
};

const PREFLIGHT = process.argv.slice(2);

// Fixtures: patient P1 on file (auto-matched sheet row A, next appointment
// in two days), patient P2 on file, sheet row B not on file, B1/B2 free.
const P1 = "00000000-0000-4000-8000-0000000000e1";
const P2 = "00000000-0000-4000-8000-0000000000e2";
const ROW_A = "00000000-0000-4000-8000-0000000000ea";
const ROW_B = "00000000-0000-4000-8000-0000000000eb";
const TODAY = "(now() at time zone 'Asia/Manila')::date";
const seed = async () => {
  await client.query("update ops.units set status = 'available', lock_reason = null where id in ('unit-B1', 'unit-B2')");
  await client.query(
    `insert into ops.patients (id, patient_number, first_name, last_name, sex, status, admitted_at) values
     ($1, 'RLSTEST-SA1', 'Sheet', 'Returnee', 'F', 'check_up', '2026-01-10'),
     ($2, 'RLSTEST-SA2', 'Other', 'Child', 'M', 'ongoing', '2026-01-10')`,
    [P1, P2]
  );
  await client.query(
    `insert into ops.house_sheet_people (id, name_key, patient_name, carer_name, relationship, next_appointment_on, treatment,
       first_seen_on, run_started_on, last_seen_on, match_status, matched_patient_id, match_method)
     values ($1, 'rlstest|returnee', 'Returnee, Sheet', 'Mama Sheet', 'mother', ${TODAY} + 2, 'chemo',
             ${TODAY} - 3, ${TODAY} - 3, ${TODAY}, 'auto_matched', $3, 'exact'),
            ($2, 'rlstest|newkid', 'Newkid, Sheet', 'Papa New', 'father', null, null,
             ${TODAY}, ${TODAY}, ${TODAY}, 'unmatched', null, null)`,
    [ROW_A, ROW_B, P1]
  );
};
const withSeed = (extra) => ({
  setup: async () => {
    await seed();
    if (extra) await extra();
  },
});
const stayP2InB2 = () =>
  client.query(`insert into ops.stays (patient_id, bed_position_id, check_in_at, status) values ($1, 'unit-B2-A', current_date, 'in_house')`, [P2]);
const stayP1InB1 = () =>
  client.query(`insert into ops.stays (id, patient_id, bed_position_id, check_in_at, status)
                values ('00000000-0000-4000-8000-0000000000f1', $1, 'unit-B1-A', current_date - 1, 'in_house')`, [P1]);
const STAY1 = "00000000-0000-4000-8000-0000000000f1";

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

  // --- the daily admission reset (0089) ---------------------------------------
  // The reset function is the cron's: run it here as postgres from inside the scenario.
  const asPostgres = (sql) => async () => {
    await client.query("reset role");
    const r = await client.query(sql);
    await client.query("set local role authenticated");
    return r;
  };
  // The cron may already have logged today on this database: the scenario starts the day afresh (rolled back).
  const resetAt = (hhmm) => async () => {
    await client.query(`delete from ops.admission_resets where day = ${TODAY}`);
    await client.query(`update shared.app_settings set admission_reset_at = '${hhmm}' where id`);
  };
  const P1NightBefore = async () => {
    await stayP1InB1();
  };
  const P1Reset = async () => {
    await stayP1InB1();
    await client.query(`update ops.stays set status = 'checked_out', check_out_at = ${TODAY}, check_out_reason = 'daily_reset' where id = '${STAY1}'`);
  };
  const carerForP1 = () =>
    client.query(`insert into ops.carers (id, patient_id, name, relationship, sex, effective_from) values ('00000000-0000-4000-8000-0000000000c1', '${P1}', 'Mama Sheet', 'mother', 'F', ${TODAY} - 1)`);

  await scenario(ids, "before the reset time nothing is checked out", "social_worker",
    withSeed(async () => { await resetAt("23:59")(); await P1NightBefore(); }),
    asPostgres(`select ops.daily_admission_reset() as n, (select status from ops.stays where id = '${STAY1}') as s`),
    (r) => r.ok && r.data[0].n === 0 && r.data[0].s === "in_house");
  await scenario(ids, "after the reset time, last night's stays are checked out once and the day is logged", "social_worker",
    withSeed(async () => { await resetAt("00:00")(); await P1NightBefore(); await stayP2InB2(); }),
    // Two statements: a subquery beside the call would see the snapshot from before it ran.
    async () => {
      await client.query("reset role");
      const first = await client.query("select ops.daily_admission_reset() as n");
      const r = await client.query(`select ${first.rows[0].n}::int as n, ops.daily_admission_reset() as again,
                 (select check_out_reason from ops.stays where id = '${STAY1}') as reason,
                 (select status from ops.stays where patient_id = '${P2}') as p2,
                 (select count(*)::int from ops.admission_resets where day = ${TODAY}) as logged`);
      await client.query("set local role authenticated");
      return r;
    },
    // n counts every stay from before today, real ones on a live database included: at least the fixture.
    (r) => r.ok && r.data[0].n >= 1 && r.data[0].again === 0 && r.data[0].reason === "daily_reset" && r.data[0].p2 === "in_house" && r.data[0].logged === 1);
  await scenario(ids, "staff cannot run the reset themselves", "social_worker", withSeed(), q("select ops.daily_admission_reset()"), denied);
  await scenario(ids, "the reset log is readable by house staff", "house_staff",
    withSeed(async () => { await resetAt("00:00")(); await client.query("select ops.daily_admission_reset()"); }),
    q("select day from ops.admission_resets where day = " + TODAY), rows(1));
  await scenario(ids, "same bed as last night: one click keeps carer, visit and bed, writes tonight's night, asks no rules", "social_worker",
    withSeed(async () => { await carerForP1(); await stayP1InB1(); await client.query(`update ops.stays set carer_id = '00000000-0000-4000-8000-0000000000c1' where id = '${STAY1}'`); await client.query(`update ops.stays set status = 'checked_out', check_out_at = ${TODAY}, check_out_reason = 'daily_reset' where id = '${STAY1}'`); }),
    last({ sql: `select ops.readmit_for_tonight('${P1}')` },
         { sql: `select s.visit_id = '${STAY1}' as same_visit, s.carer_id = '00000000-0000-4000-8000-0000000000c1' as same_carer, s.bed_position_id = 'unit-B1-A' as same_bed,
                        exists (select 1 from ops.bed_nights bn where bn.stay_id = s.id and bn.night = ${TODAY}) as night,
                        (select count(*)::int from ops.stay_orientation_checks c where c.stay_id = s.id) as ticks
                 from ops.stays s where s.patient_id = '${P1}' and s.status = 'in_house'` }),
    (r) => r.ok && r.rows === 1 && r.data[0].same_visit && r.data[0].same_carer && r.data[0].same_bed && r.data[0].night && r.data[0].ticks === 0);
  await scenario(ids, "another bed tonight goes through the bed rules", "social_worker", withSeed(P1Reset),
    last({ sql: `select ops.readmit_for_tonight('${P1}', 'unit-B2')` }, { sql: `select bed_position_id as b from ops.stays where patient_id = '${P1}' and status = 'in_house'` }),
    value("b", "unit-B2-A"));
  await scenario(ids, "a child with no night to continue must be checked in", "social_worker", withSeed(),
    q(`select ops.readmit_for_tonight('${P2}')`), (r) => !r.ok && r.code === "P0002");
  await scenario(ids, "a taken bed is refused tonight", "social_worker",
    withSeed(async () => { await P1Reset(); await client.query(`insert into ops.stays (patient_id, bed_position_id, check_in_at, status) values ('${P2}', 'unit-B1-A', ${TODAY}, 'in_house')`); }),
    q(`select ops.readmit_for_tonight('${P1}')`), duplicate);
  await scenario(ids, "house staff cannot give tonight's bed", "house_staff", withSeed(P1Reset), q(`select ops.readmit_for_tonight('${P1}')`), denied);
  await scenario(ids, "two open nights for one child are impossible", "social_worker",
    withSeed(async () => { await stayP1InB1(); }),
    asPostgres(`insert into ops.stays (patient_id, bed_position_id, check_in_at, status) values ('${P1}', 'unit-B2-A', ${TODAY}, 'in_house')`), duplicate);
  await scenario(ids, "a plain check-in after the reset continues the visit", "social_worker", withSeed(P1Reset),
    last({ sql: `select ops.check_in(p_rules_discussed => true, p_unit_id => 'unit-B1', p_check_in_at => ${TODAY}, p_patient_id => '${P1}')` },
         { sql: `select visit_id = '${STAY1}' as v from ops.stays where patient_id = '${P1}' and status = 'in_house'` }),
    value("v", true));
  await scenario(ids, "a first check-in starts its own visit", "social_worker", withSeed(),
    last({ sql: `select ops.check_in(p_rules_discussed => true, p_unit_id => 'unit-B1', p_check_in_at => ${TODAY}, p_patient_id => '${P2}')` },
         { sql: `select visit_id = id as v from ops.stays where patient_id = '${P2}' and status = 'in_house'` }),
    value("v", true));
  await scenario(ids, "everyone signed in reads the reset times", "house_staff", withSeed(),
    q("select admission_reset_at, admission_finalize_by from shared.app_settings"), rows(1));

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
