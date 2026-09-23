// Proves 0051 (admission from NCH's Occupancy Tracker, nightly beds, the
// sheet's appointments) against the live database, one scenario per
// transaction, every transaction rolled back. Same harness as
// scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1 acknowledges
// that lafopsys has one database.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/sheet-admission-matrix.mjs
// Pre-flight (before 0049-0051 are applied, one rolled-back transaction):
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/sheet-admission-matrix.mjs supabase/migrations/0049_check_in.sql supabase/migrations/0050_module_access.sql supabase/migrations/0051_sheet_admission.sql
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
const setLevel = (role, module, level) =>
  client.query(
    `insert into shared.module_access (role, module, level) values ($1, $2, $3)
     on conflict (role, module) do update set level = excluded.level`,
    [role, module, level]
  );
const admitA = `select ops.admit_from_sheet(p_sheet_row_id => '${ROW_A}', p_unit_id => 'unit-B1', p_check_in_at => ${TODAY} - 3) as r`;
const newKid = JSON.stringify({
  patient_first_name: "Sheet",
  patient_last_name: "Newkid",
  patient_sex: "M",
  carer_name: "Papa New",
  carer_relationship: "Father",
  hospital_id: null,
  diagnosis_ids: [],
});
const admitB = (json = newKid) =>
  `select ops.admit_from_sheet(p_sheet_row_id => '${ROW_B}', p_unit_id => 'unit-B1', p_check_in_at => ${TODAY}, p_referral => '${json}'::jsonb) as r`;

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

  // --- admitting from the sheet ------------------------------------------------
  await scenario(ids, "a child on file is admitted from the sheet in one step", "social_worker", withSeed(),
    last({ sql: admitA },
      { sql: `select (select count(*) from ops.stays where patient_id = $1 and status = 'in_house' and check_in_at = ${TODAY} - 3) = 1
                 and (select count(*) from ops.bed_nights n join ops.stays s on s.id = n.stay_id where s.patient_id = $1 and n.night = ${TODAY}) = 1
                 and (select match_status = 'confirmed' and matched_patient_id = $1 from ops.house_sheet_people where id = $2)
                 and (select count(*) from ops.appointments where patient_id = $1 and source = 'house_sheet' and date = ${TODAY} + 2 and needs_transport) = 1 as ok`,
        params: [P1, ROW_A] }),
    value("ok", true));
  await scenario(ids, "a new child is admitted with the encode form, as an NCH referral", "social_worker", withSeed(),
    last({ sql: admitB() },
      { sql: `select r.source = 'house_sheet' and r.status = 'admitted'
                 and p.case_number like 'LFCN-%' and p.patient_number is null
                 and h.match_status = 'encoded' and h.referral_id = r.id
                 and exists (select 1 from ops.bed_nights n join ops.stays s on s.id = n.stay_id where s.patient_id = p.id and n.night = ${TODAY})
                 and exists (select 1 from ops.carers c where c.patient_id = p.id and c.name = 'Papa New') as ok
               from ops.house_sheet_people h join ops.referrals r on r.id = h.referral_id join ops.patients p on p.id = r.admitted_patient_id
               where h.id = $1`, params: [ROW_B] }),
    value("ok", true));
  await scenario(ids, "a new child needs a sex", "social_worker", withSeed(),
    q(admitB(JSON.stringify({ patient_first_name: "Sheet", patient_last_name: "Newkid" }))), checkFailed);
  await scenario(ids, "an unlinked name needs the form or a patient", "social_worker", withSeed(),
    q(`select ops.admit_from_sheet(p_sheet_row_id => '${ROW_B}', p_unit_id => 'unit-B1', p_check_in_at => ${TODAY})`), checkFailed);
  await scenario(ids, "an unlinked name can be admitted as a patient picked by hand", "social_worker", withSeed(),
    last({ sql: `select ops.admit_from_sheet(p_sheet_row_id => '${ROW_B}', p_unit_id => 'unit-B1', p_check_in_at => ${TODAY}, p_patient_id => '${P2}')` },
      { sql: "select match_status = 'confirmed' and matched_patient_id = $2 and match_method = 'manual' as ok from ops.house_sheet_people where id = $1", params: [ROW_B, P2] }),
    value("ok", true));
  await scenario(ids, "a 'not a patient' row is refused", "social_worker",
    withSeed(() => client.query("update ops.house_sheet_people set match_status = 'dismissed', matched_patient_id = null where id = $1", [ROW_A])),
    q(admitA), checkFailed);
  await scenario(ids, "driver cannot admit from the sheet", "driver", withSeed(), q(admitA), denied);
  await scenario(ids, "a view-only social worker cannot admit", "social_worker",
    withSeed(() => setLevel("social_worker", "patients", "view")), q(admitA), denied);
  await scenario(ids, "a plain check-in also records tonight's bed", "social_worker", withSeed(),
    last({ sql: `select ops.check_in(p_unit_id => 'unit-B1', p_check_in_at => ${TODAY}, p_patient_id => '${P2}')` },
      { sql: `select count(*)::int as n from ops.bed_nights n join ops.stays s on s.id = n.stay_id where s.patient_id = $1 and n.night = ${TODAY}`, params: [P2] }),
    value("n", 1));

  // --- tonight's bed --------------------------------------------------------------
  await scenario(ids, "same bed tonight is recorded once however often it is confirmed", "social_worker", withSeed(stayP1InB1),
    last({ sql: `select ops.confirm_night('${STAY1}')` }, { sql: `select ops.confirm_night('${STAY1}')` },
      { sql: `select count(*)::int as n from ops.bed_nights where stay_id = $1 and night = ${TODAY} and bed_position_id = 'unit-B1-A'`, params: [STAY1] }),
    value("n", 1));
  await scenario(ids, "a change of bed moves the stay and tonight's row", "social_worker", withSeed(stayP1InB1),
    last({ sql: `select ops.confirm_night('${STAY1}')` }, { sql: `select ops.confirm_night('${STAY1}', 'unit-B2')` },
      { sql: `select (select bed_position_id from ops.stays where id = $1) = 'unit-B2-A'
                 and (select bed_position_id from ops.bed_nights where stay_id = $1 and night = ${TODAY}) = 'unit-B2-A' as ok`, params: [STAY1] }),
    value("ok", true));
  await scenario(ids, "a taken bed is refused tonight", "social_worker",
    withSeed(async () => { await stayP1InB1(); await stayP2InB2(); }), q(`select ops.confirm_night('${STAY1}', 'unit-B2')`), duplicate);
  await scenario(ids, "a view-only social worker cannot confirm tonight", "social_worker",
    withSeed(async () => { await stayP1InB1(); await setLevel("social_worker", "patients", "view"); }),
    q(`select ops.confirm_night('${STAY1}')`), denied);
  await scenario(ids, "house staff read tonight's beds (House Operations)", "house_staff",
    withSeed(async () => {
      await stayP1InB1();
      await client.query(`insert into ops.bed_nights (night, stay_id, bed_position_id) values (${TODAY}, $1, 'unit-B1-A')`, [STAY1]);
    }), q(`select id from ops.bed_nights where stay_id = '${STAY1}'`), rows(1));
  await scenario(ids, "nobody writes nights directly", "admin", withSeed(stayP1InB1),
    q(`insert into ops.bed_nights (night, stay_id, bed_position_id) values (${TODAY}, '${STAY1}', 'unit-B1-A')`), denied);

  // --- the sheet keeps appointments current ------------------------------------------
  await scenario(ids, "the sync adds the sheet's next appointment for a child in the house", "admin",
    withSeed(async () => { await stayP1InB1(); await client.query("select ops.sync_sheet_appointments()"); }),
    q(`select count(*)::int as n from ops.appointments where patient_id = '${P1}' and source = 'house_sheet' and date = ${TODAY} + 2`), value("n", 1));
  await scenario(ids, "a new date on the sheet moves that appointment, not a hand-made one", "admin",
    withSeed(async () => {
      await stayP1InB1();
      await client.query(`insert into ops.appointments (patient_id, date, time, clinic, purpose) values ($1, ${TODAY} + 9, '10:00', 'Dental', 'Hand-made')`, [P1]);
      await client.query("select ops.sync_sheet_appointments()");
      await client.query(`update ops.house_sheet_people set next_appointment_on = ${TODAY} + 5 where id = $1`, [ROW_A]);
      await client.query("select ops.sync_sheet_appointments()");
    }),
    q(`select string_agg(source || ':' || (date - ${TODAY})::text, ',' order by source) as s from ops.appointments where patient_id = '${P1}'`),
    value("s", "house_sheet:5,manual:9"));
  await scenario(ids, "a child not checked in gets no appointment from the sheet", "admin",
    withSeed(() => client.query("select ops.sync_sheet_appointments()")),
    q(`select count(*)::int as n from ops.appointments where patient_id = '${P1}'`), value("n", 0));
  await scenario(ids, "staff cannot run the sheet sync's appointment step", "admin", withSeed(),
    q("select ops.sync_sheet_appointments()"), denied);

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
