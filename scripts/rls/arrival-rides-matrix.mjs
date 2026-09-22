// Proves 0052 (arrival method, ride-app rides, the 2-patient reimbursement
// rule, pay-outs, ride receipts) against the live database, one scenario per
// transaction, every transaction rolled back. Same harness as
// scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1 acknowledges
// that lafopsys has one database.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/arrival-rides-matrix.mjs
// Pre-flight (before 0049-0052 are applied, one rolled-back transaction):
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/arrival-rides-matrix.mjs supabase/migrations/0049_check_in.sql supabase/migrations/0050_module_access.sql supabase/migrations/0051_sheet_admission.sql supabase/migrations/0052_arrival_rides.sql
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

const ROLES = ["admin", "social_worker", "house_staff", "driver", "finance", "board", "volunteer"];
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

// Fixtures: three patients checked in today (stays S1..S3), none with an arrival yet.
const P = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2", "00000000-0000-4000-8000-0000000000a3"];
const S = ["00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000b2", "00000000-0000-4000-8000-0000000000b3"];
const seed = async () => {
  for (let i = 0; i < 3; i++) {
    await client.query(
      `insert into ops.patients (id, patient_number, first_name, last_name, sex, status, admitted_at)
       values ($1, $2, 'Ride', $3, 'F', 'ongoing', current_date)`,
      [P[i], `RLSTEST-AR${i}`, `Rider${i}`]
    );
    await client.query(
      `insert into ops.stays (id, patient_id, bed_position_id, check_in_at, status) values ($1, $2, $3, current_date, 'in_house')`,
      [S[i], P[i], `unit-B${i + 1}-A`]
    );
  }
};
const withSeed = (extra) => ({
  setup: async () => {
    await seed();
    if (extra) await extra();
  },
});
const setLevel = (role, module, level) =>
  client.query(
    `insert into shared.module_access (role, module, level) values ($1, $2, $3)
     on conflict (role, module) do update set level = excluded.level`,
    [role, module, level]
  );
const RIDE = "00000000-0000-4000-8000-0000000000c9";
// S1 and S2 came together by Grab (fare 480); S3 by Angkas alone.
const twoOnGrab = async () => {
  await client.query(`insert into ops.arrival_rides (id, ride_date, app, fare) values ($1, current_date, 'grab', 480)`, [RIDE]);
  await client.query(`update ops.stays set arrival_mode = 'ride_app', arrival_ride_id = $1 where id in ($2, $3)`, [RIDE, S[0], S[1]]);
};
const pay = `update ops.arrival_rides set reimbursed_at = current_date, reimbursed_amount = 480, reimbursed_to = 'Mama Rider' where id = '${RIDE}' returning reimbursed_by`;

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

  // --- recording arrivals -----------------------------------------------------------
  await scenario(ids, "a new Grab ride starts with the first family", "social_worker", withSeed(),
    last({ sql: `select ops.record_arrival('${S[0]}', 'ride_app', 'grab', null, 480) as r` },
      { sql: `select v.app = 'grab' and v.fare = 480 and v.riders = 1 and not v.reimbursable and v.ride_date = current_date as ok
              from ops.v_arrival_rides v join ops.stays s on s.arrival_ride_id = v.id where s.id = $1`, params: [S[0]] }),
    value("ok", true));
  await scenario(ids, "a second family joining makes the ride reimbursable", "social_worker", withSeed(),
    last({ sql: `select ops.record_arrival('${S[0]}', 'ride_app', 'grab', null, 480) as r` },
      { sql: `select ops.record_arrival('${S[1]}', 'ride_app', null, (select arrival_ride_id from ops.stays where id = '${S[0]}'))` },
      { sql: `select riders = 2 and reimbursable as ok from ops.v_arrival_rides where id = (select arrival_ride_id from ops.stays where id = $1)`, params: [S[0]] }),
    value("ok", true));
  await scenario(ids, "two on an Angkas is never reimbursable", "social_worker", withSeed(),
    last({ sql: `select ops.record_arrival('${S[0]}', 'ride_app', 'angkas', null, 150)` },
      { sql: `select ops.record_arrival('${S[1]}', 'ride_app', null, (select arrival_ride_id from ops.stays where id = '${S[0]}'))` },
      { sql: `select riders = 2 and not reimbursable as ok from ops.v_arrival_rides where id = (select arrival_ride_id from ops.stays where id = $1)`, params: [S[0]] }),
    value("ok", true));
  await scenario(ids, "LAF HOPE, own transport and ambulance need no ride", "social_worker", withSeed(),
    last({ sql: `select ops.record_arrival('${S[0]}', 'laf_hope')` }, { sql: `select ops.record_arrival('${S[1]}', 'own_transport')` },
      { sql: `select ops.record_arrival('${S[2]}', 'hospital_vehicle')` },
      { sql: `select string_agg(arrival_mode, ',' order by id) as m from ops.stays where id in ($1, $2, $3)`, params: S }),
    value("m", "laf_hope,own_transport,hospital_vehicle"));
  await scenario(ids, "switching away from a ride nobody else took removes it", "social_worker", withSeed(),
    last({ sql: `select ops.record_arrival('${S[0]}', 'ride_app', 'grab', null, 300)` },
      { sql: `select ops.record_arrival('${S[0]}', 'own_transport')` },
      { sql: "select count(*)::int as n from ops.arrival_rides where ride_date = current_date and fare = 300" }),
    value("n", 0));
  await scenario(ids, "a ride app needs the app", "social_worker", withSeed(), q(`select ops.record_arrival('${S[0]}', 'ride_app')`), (r) => !r.ok && r.code === "22023");
  await scenario(ids, "an unknown way of arriving is refused", "social_worker", withSeed(), q(`select ops.record_arrival('${S[0]}', 'helicopter')`), (r) => !r.ok && r.code === "22023");
  await scenario(ids, "a ride id on a non-ride arrival is refused by the table", "admin", withSeed(twoOnGrab),
    q(`update ops.stays set arrival_mode = 'own_transport' where id = '${S[0]}'`), checkFailed);
  await scenario(ids, "driver cannot record an arrival", "driver", withSeed(), q(`select ops.record_arrival('${S[0]}', 'laf_hope')`), denied);
  await scenario(ids, "a view-only social worker cannot record an arrival", "social_worker",
    withSeed(() => setLevel("social_worker", "patients", "view")), q(`select ops.record_arrival('${S[0]}', 'laf_hope')`), denied);

  // --- paying back ---------------------------------------------------------------------
  await scenario(ids, "a qualifying ride is paid back and signed", "social_worker", withSeed(twoOnGrab),
    q(pay), (r) => value("reimbursed_by", ids.social_worker)(r));
  await scenario(ids, "finance records a pay-out", "finance", withSeed(twoOnGrab), q(pay), (r) => value("reimbursed_by", ids.finance)(r));
  await scenario(ids, "a one-family ride cannot be paid back", "social_worker",
    withSeed(async () => {
      await twoOnGrab();
      await client.query(`update ops.stays set arrival_mode = 'own_transport', arrival_ride_id = null where id = $1`, [S[1]]);
    }), q(pay), checkFailed);
  await scenario(ids, "an Angkas cannot be paid back", "social_worker",
    withSeed(async () => {
      await twoOnGrab();
      await client.query(`update ops.arrival_rides set app = 'angkas' where id = $1`, [RIDE]);
    }), q(pay), checkFailed);
  await scenario(ids, "a pay-out needs who was paid", "social_worker", withSeed(twoOnGrab),
    q(`update ops.arrival_rides set reimbursed_at = current_date, reimbursed_amount = 480 where id = '${RIDE}'`), checkFailed);
  await scenario(ids, "the signer cannot be written by hand", "social_worker", withSeed(twoOnGrab),
    q(pay.replace("reimbursed_to = 'Mama Rider'", `reimbursed_to = 'Mama Rider', reimbursed_by = '${ids.admin}'`)),
    (r) => value("reimbursed_by", ids.social_worker)(r));
  await scenario(ids, "a paid-back ride takes no new riders", "social_worker",
    withSeed(async () => {
      await twoOnGrab();
      await client.query(`update ops.arrival_rides set reimbursed_at = current_date, reimbursed_amount = 480, reimbursed_to = 'x' where id = $1`, [RIDE]);
    }), q(`select ops.record_arrival('${S[2]}', 'ride_app', null, '${RIDE}')`), checkFailed);
  await scenario(ids, "board reads rides (Financial view)", "board", withSeed(twoOnGrab), q("select id from ops.arrival_rides"), rows(1));
  await scenario(ids, "volunteer reads no rides", "volunteer", withSeed(twoOnGrab), q("select id from ops.arrival_rides"), rows(0));
  await scenario(ids, "volunteer reads no rides through the view either", "volunteer", withSeed(twoOnGrab), q("select id from ops.v_arrival_rides"), rows(0));
  await scenario(ids, "finance sees the true rider count", "finance", withSeed(twoOnGrab),
    q(`select riders, reimbursable from ops.v_arrival_rides where id = '${RIDE}'`), (r) => r.ok && r.rows === 1 && r.data[0].riders === 2 && r.data[0].reimbursable === true);
  await scenario(ids, "house staff read rides (House Operations)", "house_staff", withSeed(twoOnGrab), q(`select id from ops.v_arrival_rides where id = '${RIDE}'`), rows(1));
  await scenario(ids, "house staff cannot pay back a ride", "house_staff", withSeed(twoOnGrab), q(pay), rows(0));

  // --- receipts ------------------------------------------------------------------------
  await scenario(ids, "a ride receipt belongs to Patients in the file library", "social_worker", withSeed(twoOnGrab),
    q(`insert into shared.files (module, record_type, record_id, object_key, folder, file_name, content_type, uploaded_by)
       values ('patients', 'ride', '${RIDE}', 'Patients/Arrival Rides/x', 'Patients/Arrival Rides', 'r.jpg', 'image/jpeg', auth.uid())`), rows(1));
  await scenario(ids, "a ride receipt cannot be filed under Financial", "admin", withSeed(twoOnGrab),
    q(`insert into shared.files (module, record_type, record_id, object_key, folder, file_name, content_type, uploaded_by)
       values ('finance', 'ride', '${RIDE}', 'x/y', 'x', 'r.jpg', 'image/jpeg', auth.uid())`), checkFailed);

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
