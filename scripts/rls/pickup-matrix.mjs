// Proves 0053 (LAF HOPE pick-ups: the manifest, on-board ticks, trip progress,
// an arrival naming its trip, the 'transport' module) against the live
// database, one scenario per transaction, every transaction rolled back. Same
// harness as scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1
// acknowledges that lafopsys has one database.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/pickup-matrix.mjs
// 0076 (vehicles, the odometer guard) pre-flight:
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/pickup-matrix.mjs supabase/migrations/0076_fuel_vehicles.sql supabase/migrations/0077_vehicle_expenses.sql supabase/migrations/0078_odometer_photos.sql
// Pre-flight (before 0049-0053 are applied, one rolled-back transaction):
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/pickup-matrix.mjs supabase/migrations/0049_check_in.sql supabase/migrations/0050_module_access.sql supabase/migrations/0051_sheet_admission.sql supabase/migrations/0052_arrival_rides.sql supabase/migrations/0053_laf_hope_pickups.sql
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
  // A silently dropped connection (2026-10-02) otherwise leaves the run waiting forever.
  keepAlive: true,
  query_timeout: 120000,
});

const ROLES = ["admin", "social_worker", "house_staff", "driver", "volunteer", "finance"];
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

// Fixtures: patient P1 on file (sheet row A settled to them), sheet row B a
// new child; stay S1 for P1 (to link an arrival to a trip).
const P1 = "00000000-0000-4000-8000-0000000000d1";
const ROW_A = "00000000-0000-4000-8000-0000000000da";
const ROW_B = "00000000-0000-4000-8000-0000000000db";
const S1 = "00000000-0000-4000-8000-0000000000d5";
const TRIP = "00000000-0000-4000-8000-0000000000d9";
const TODAY = "(now() at time zone 'Asia/Manila')::date";
const seed = async () => {
  await client.query(
    `insert into ops.patients (id, patient_number, first_name, last_name, sex, status, admitted_at)
     values ($1, 'RLSTEST-TP1', 'Pickup', 'Known', 'F', 'check_up', '2026-01-10')`,
    [P1]
  );
  await client.query(
    `insert into ops.house_sheet_people (id, name_key, patient_name, carer_name, first_seen_on, run_started_on, last_seen_on, match_status, matched_patient_id, match_method)
     values ($1, 'rlstest|pickupknown', 'Known, Pickup', 'Mama Known', ${TODAY}, ${TODAY}, ${TODAY}, 'auto_matched', $3, 'exact'),
            ($2, 'rlstest|pickupnew', 'New, Pickup', 'Papa New', ${TODAY}, ${TODAY}, ${TODAY}, 'unmatched', null, null)`,
    [ROW_A, ROW_B, P1]
  );
};
const withSeed = (extra) => ({
  setup: async () => {
    await seed();
    if (extra) await extra();
  },
});
// A scheduled pick-up for both, made directly -- on a test vehicle that is never
// tracked (0076), so these scenarios hold whether or not LAF HOPE is tracked.
const trip = async (status = "scheduled") => {
  await client.query(`insert into ops.vehicles (name) values ('RLSTEST Hope') on conflict (name) do nothing`);
  await client.query(
    `insert into ops.trips (id, date, direction, vehicle, departure_time, status) values ($1, ${TODAY}, 'from_hospital', 'RLSTEST Hope', '07:30', 'scheduled')`,
    [TRIP]
  );
  await client.query(
    `insert into ops.trip_manifest (trip_id, house_sheet_person_id, name) values ($1, $2, 'Known, Pickup'), ($1, $3, 'New, Pickup')`,
    [TRIP, ROW_A, ROW_B]
  );
  if (status !== "scheduled") await client.query("update ops.trips set status = $2 where id = $1", [TRIP, status]);
};
const setLevel = (role, module, level) =>
  client.query(
    `insert into shared.module_access (role, module, level) values ($1, $2, $3)
     on conflict (role, module) do update set level = excluded.level`,
    [role, module, level]
  );
const boardA = `update ops.trip_manifest set boarded_at = now() where trip_id = '${TRIP}' and house_sheet_person_id = '${ROW_A}' returning boarded_by`;
const badInput = (r) => !r.ok && r.code === "22023";

async function main() {
  await client.connect();
  // If the connection drops mid-run, the server ends the open transaction (and the
  // pre-flight's locks on live tables) instead of holding them.
  await client.query("set idle_in_transaction_session_timeout = '60s'");
  if (PREFLIGHT.length) {
    await client.query("begin");
    for (const file of PREFLIGHT) {
      await client.query(await readFile(file, "utf8"));
      console.log("pre-flight applied (rolled back at the end):", file);
    }
  }
  const ids = await accountIds();
  console.log("Acting accounts:", Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v ? "yes" : "none"])));
  const create = (rows) => `select ops.create_pickup(${TODAY}, '07:30', '${ids.driver}', array[${rows.map((r) => `'${r}'`).join(",")}]::uuid[]) as id`;

  // --- building the manifest ---------------------------------------------------------
  // Test accounts are kept inactive between scenarios; a real driver is active.
  await scenario(ids, "social worker builds a pick-up from NCH's list", "social_worker",
    withSeed(() => client.query("update shared.staff set active = true where id = $1", [ids.driver])),
    last({ sql: create([ROW_A, ROW_B]) },
      { sql: `select t.vehicle = 'LAF HOPE Transport' and t.direction = 'from_hospital' and t.status = 'scheduled' and t.driver_staff_id = $1
                 and (select count(*) from ops.trip_manifest m where m.trip_id = t.id) = 2
                 and (select patient_id from ops.trip_manifest m where m.trip_id = t.id and m.house_sheet_person_id = $2) = $3
                 and (select carer_name from ops.trip_manifest m where m.trip_id = t.id and m.house_sheet_person_id = $4) = 'Papa New' as ok
               from ops.trips t where exists (select 1 from ops.trip_manifest m where m.trip_id = t.id and m.house_sheet_person_id = $2)`, params: [ids.driver, ROW_A, P1, ROW_B] }),
    value("ok", true));
  await scenario(ids, "a pick-up needs someone to pick up", "social_worker", withSeed(),
    q(`select ops.create_pickup(${TODAY}, '07:30', null, array[]::uuid[])`), badInput);
  await scenario(ids, "an inactive driver cannot be assigned", "social_worker", withSeed(),
    q(create([ROW_A])), (r) => !r.ok && r.code === "P0002");
  await scenario(ids, "house staff cannot build a pick-up", "house_staff", withSeed(), q(create([ROW_A])), denied);
  await scenario(ids, "a view-only social worker cannot build a pick-up", "social_worker",
    withSeed(() => setLevel("social_worker", "transport", "view")), q(create([ROW_A])), denied);

  // --- on board --------------------------------------------------------------------------
  await scenario(ids, "the driver ticks a passenger on board and is stamped", "driver", withSeed(() => trip()),
    q(boardA), (r) => value("boarded_by", ids.driver)(r));
  await scenario(ids, "the stamp cannot be written by hand", "driver", withSeed(() => trip()),
    q(`update ops.trip_manifest set boarded_at = now(), boarded_by = '${ids.admin}' where trip_id = '${TRIP}'`), denied);
  await scenario(ids, "the driver cannot rename a passenger", "driver", withSeed(() => trip()),
    q(`update ops.trip_manifest set name = 'Someone else' where trip_id = '${TRIP}'`), denied);
  await scenario(ids, "house staff cannot tick on board", "house_staff", withSeed(() => trip()), q(boardA), rows(0));
  await scenario(ids, "house staff read the manifest", "house_staff", withSeed(() => trip()), q(`select id from ops.trip_manifest where trip_id = '${TRIP}'`), rows(2));
  await scenario(ids, "volunteer reads no manifest", "volunteer", withSeed(() => trip()), q(`select id from ops.trip_manifest where trip_id = '${TRIP}'`), rows(0));
  await scenario(ids, "someone on board cannot be taken off the manifest", "social_worker",
    withSeed(async () => { await trip(); await client.query(`update ops.trip_manifest set boarded_at = now() where house_sheet_person_id = $1`, [ROW_A]); }),
    q(`delete from ops.trip_manifest where house_sheet_person_id = '${ROW_A}'`), checkFailed);
  await scenario(ids, "someone not on board comes off the manifest", "social_worker", withSeed(() => trip()),
    q(`delete from ops.trip_manifest where house_sheet_person_id = '${ROW_B}'`), rows(1));

  // --- the trip moves --------------------------------------------------------------------
  await scenario(ids, "the driver departs and it is stamped", "driver", withSeed(() => trip()),
    q(`update ops.trips set status = 'in_progress' where id = '${TRIP}' returning departed_at is not null and arrived_at is null as ok`), value("ok", true));
  await scenario(ids, "the driver arrives and it is stamped", "driver", withSeed(() => trip("in_progress")),
    q(`update ops.trips set status = 'completed' where id = '${TRIP}' returning arrived_at is not null as ok`), value("ok", true));
  await scenario(ids, "an arrived trip's manifest is closed to boarding", "driver", withSeed(() => trip("completed")), q(boardA), checkFailed);
  await scenario(ids, "an arrived trip takes no new passengers", "social_worker", withSeed(() => trip("completed")),
    q(`insert into ops.trip_manifest (trip_id, name) values ('${TRIP}', 'Late, Name')`), checkFailed);
  await scenario(ids, "a driver with House Operations removed still runs the trip", "driver",
    withSeed(async () => { await trip(); await setLevel("driver", "house_ops", "none"); }),
    q(`update ops.trips set status = 'in_progress' where id = '${TRIP}'`), rows(1));

  // --- the arrival names its trip ----------------------------------------------------------
  await scenario(ids, "check-in links a LAF HOPE arrival to its trip and the manifest learns the patient", "social_worker",
    withSeed(async () => {
      await trip("completed");
      await client.query(`insert into ops.stays (id, patient_id, bed_position_id, check_in_at, status) values ($1, $2, 'unit-B1-A', current_date, 'in_house')`, [S1, P1]);
    }),
    last({ sql: `select ops.record_arrival('${S1}', 'laf_hope', null, null, null, '${TRIP}')` },
      { sql: `select (select arrival_trip_id from ops.stays where id = $1) = $2
                 and (select patient_id from ops.trip_manifest where trip_id = $2 and house_sheet_person_id = $3) = $4 as ok`, params: [S1, TRIP, ROW_A, P1] }),
    value("ok", true));
  await scenario(ids, "only a LAF HOPE arrival has a trip", "social_worker",
    withSeed(async () => {
      await trip();
      await client.query(`insert into ops.stays (id, patient_id, bed_position_id, check_in_at, status) values ($1, $2, 'unit-B1-A', current_date, 'in_house')`, [S1, P1]);
    }), q(`select ops.record_arrival('${S1}', 'own_transport', null, null, null, '${TRIP}')`), badInput);

  // --- the grid knows the module --------------------------------------------------------------
  await scenario(ids, "drivers start with Transport edit", "admin", null,
    q("select level from shared.module_access where role = 'driver' and module = 'transport'"), value("level", "edit"));

  // --- 0076: vehicles and the odometer ------------------------------------------------------
  const VEH = "00000000-0000-4000-8000-0000000000e1";
  const T2 = "00000000-0000-4000-8000-0000000000e2";
  const T3 = "00000000-0000-4000-8000-0000000000e3";
  // A tracked test vehicle, with today's odometer photo in (0078) unless a scenario is about the photo.
  const vehicle = async (start = 1000, photo = true) => {
    await client.query(`insert into ops.vehicles (id, name, start_odometer) values ($1, 'RLSTEST Van', $2)`, [VEH, start]);
    if (photo) await client.query(odoPhoto(VEH));
  };
  const odoPhoto = (vehicleId, id = null) =>
    `insert into ops.odometer_photos (${id ? "id, " : ""}vehicle_id, stage, taken_by, object_key, bytes)
     values (${id ? `'${id}', ` : ""}'${vehicleId}', 'depart', '${ids.driver}', 'Transport/RLSTEST/' || gen_random_uuid() || '.jpg', 1000)`;
  const vtrip = async (id = T2, stage = "scheduled", start = 1000, end = 1020) => {
    await client.query(`insert into ops.trips (id, date, direction, vehicle_id, vehicle, departure_time, status, destination)
      values ($1, ${TODAY}, 'errand', $2, 'typed name', '09:00', 'scheduled', 'Test errand')`, [id, VEH]);
    if (stage !== "scheduled") await client.query(`update ops.trips set status = 'in_progress', odometer_start = $2 where id = $1`, [id, start]);
    if (stage === "completed") await client.query(`update ops.trips set status = 'completed', odometer_end = $2 where id = $1`, [id, end]);
  };
  const tracked = (stage, more) => ({ setup: async () => { await vehicle(); await vtrip(T2, stage); if (more) await more(); } });
  const afterAnother = { setup: async () => { await vehicle(); await vtrip(T3, "completed", 1000, 1050); await vtrip(T2); } };
  const depart = (km) => q(`update ops.trips set status = 'in_progress', odometer_start = ${km} where id = '${T2}' returning odometer_start`);
  const arrive = (km) => q(`update ops.trips set status = 'completed', odometer_end = ${km} where id = '${T2}' returning odometer_end`);
  const correct = (start, end, reason) => q(`select ops.correct_odometer('${T2}', ${start}, ${end}, $1)`, [reason]);

  await scenario(ids, "a trip takes its vehicle's name and link", "driver", tracked(),
    q(`select vehicle = 'RLSTEST Van' and vehicle_id = '${VEH}' as ok from ops.trips where id = '${T2}'`), value("ok", true));
  await scenario(ids, "a pick-up made by name is linked to LAF HOPE", "admin", null,
    q(`insert into ops.trips (date, direction, vehicle, departure_time) values (${TODAY}, 'from_hospital', 'LAF HOPE Transport', '07:30')
       returning vehicle_id = (select id from ops.vehicles where name = 'LAF HOPE Transport') as ok`), value("ok", true));
  await scenario(ids, "an untracked vehicle's trip leaves without a reading", "driver", withSeed(() => trip()),
    q(`update ops.trips set status = 'in_progress' where id = '${TRIP}'`), rows(1));
  await scenario(ids, "an untracked vehicle is on one trip at a time too", "driver",
    withSeed(async () => {
      await trip("in_progress");
      await client.query(`insert into ops.trips (id, date, direction, vehicle, departure_time) values ($1, ${TODAY}, 'errand', 'RLSTEST Hope', '08:00')`, [T3]);
    }),
    q(`update ops.trips set status = 'in_progress' where id = '${T3}'`), (r) => duplicate(r) && /still on another trip/.test(r.msg));
  await scenario(ids, "the driver departs with the odometer", "driver", tracked(), depart(1000), value("odometer_start", 1000));
  await scenario(ids, "a tracked vehicle can't leave without a reading", "driver", tracked(),
    q(`update ops.trips set status = 'in_progress' where id = '${T2}'`), badInput);
  await scenario(ids, "the odometer can't go below the starting reading", "driver", tracked(), depart(999), badInput);
  await scenario(ids, "the odometer can't go below the last trip", "driver", afterAnother, depart(1040), badInput);
  await scenario(ids, "the next trip starts from the last reading", "driver", afterAnother, depart(1050), value("odometer_start", 1050));
  await scenario(ids, "the driver arrives with the odometer", "driver", tracked("in_progress"), arrive(1023), value("odometer_end", 1023));
  await scenario(ids, "a tracked vehicle can't arrive without a reading", "driver", tracked("in_progress"),
    q(`update ops.trips set status = 'completed' where id = '${T2}'`), badInput);
  await scenario(ids, "the arrival reading can't be below the departure", "driver", tracked("in_progress"), arrive(999), badInput);
  await scenario(ids, "a vehicle is on one trip at a time", "driver",
    { setup: async () => { await vehicle(); await vtrip(T3, "in_progress", 1000); await vtrip(T2); } }, depart(1000), duplicate);
  await scenario(ids, "'Not left yet' takes the reading back with the departure", "driver", tracked("in_progress"),
    q(`update ops.trips set status = 'scheduled' where id = '${T2}' returning odometer_start is null and departed_at is null as ok`), value("ok", true));
  await scenario(ids, "an arrived trip's reading is frozen for the driver", "driver", tracked("completed"),
    q(`update ops.trips set odometer_end = 1030 where id = '${T2}'`), denied);
  await scenario(ids, "house staff can't change an arrived trip's reading either", "house_staff", tracked("completed"),
    q(`update ops.trips set odometer_start = 1001 where id = '${T2}'`), denied);
  await scenario(ids, "setting the correction flag by hand opens nothing", "driver", tracked("completed"),
    last({ sql: "select set_config('ops.odometer_correction', 'on', true)" }, { sql: `update ops.trips set odometer_end = 1030 where id = '${T2}'` }), denied);
  await scenario(ids, "a trip with readings can't be deleted", "driver", tracked("completed"), q(`delete from ops.trips where id = '${T2}'`), denied);
  await scenario(ids, "the driver can't correct a reading", "driver", tracked("completed"), correct(1000, 1030, "typo on arrival"), denied);
  await scenario(ids, "a correction needs a reason", "admin", tracked("completed"), correct(1000, 1030, "  "), badInput);
  await scenario(ids, "the Super Admin corrects a reading, on the record", "admin", tracked("completed"),
    last({ sql: `select ops.correct_odometer('${T2}', 1000, 1030, 'typo on arrival')` },
      { sql: `select (select odometer_end from ops.trips where id = $1) = 1030
                 and exists (select 1 from ops.odometer_corrections where trip_id = $1 and old_end = 1020 and new_end = 1030 and corrected_by = $2) as ok`, params: [T2, ids.admin] }),
    value("ok", true));
  await scenario(ids, "nobody writes the correction log by hand", "admin", tracked("completed"),
    q(`insert into ops.odometer_corrections (trip_id, reason) values ('${T2}', 'forged entry')`), denied);
  await scenario(ids, "the driver reads the correction log", "driver",
    tracked("completed", () => client.query(`insert into ops.odometer_corrections (trip_id, old_end, new_end, reason) values ($1, 1020, 1030, 'seeded')`, [T2])),
    q(`select id from ops.odometer_corrections where trip_id = '${T2}'`), rows(1));
  await scenario(ids, "a volunteer reads no vehicles", "volunteer", tracked(), q(`select id from ops.vehicles where id = '${VEH}'`), rows(0));
  await scenario(ids, "the drums start from the last reading", "driver", tracked("completed"),
    q(`select last_reading from ops.v_vehicle_odometer where vehicle_id = '${VEH}'`), value("last_reading", 1020));
  await scenario(ids, "the Super Admin adds a vehicle", "admin", null,
    q(`insert into ops.vehicles (name, plate_no, tank_litres) values ('RLSTEST Second', 'ABC 1234', 60)`), rows(1));
  await scenario(ids, "a social worker can't add a vehicle", "social_worker", null, q(`insert into ops.vehicles (name) values ('RLSTEST Second')`), denied);
  await scenario(ids, "the driver can't change a vehicle (0 rows)", "driver", tracked(), q(`update ops.vehicles set start_odometer = 5 where id = '${VEH}'`), rows(0));
  await scenario(ids, "the starting odometer stays once trips have readings", "admin", tracked("completed"),
    q(`update ops.vehicles set start_odometer = 900 where id = '${VEH}'`), badInput);


  // --- 0077: the fuel and expense log ------------------------------------------------------
  const EXP = "00000000-0000-4000-8000-0000000000f1";
  const fill = (odo = "1010", litres = "30", extra = "") =>
    `insert into ops.vehicle_expenses (vehicle_id, kind, amount, litres, full_tank, odometer${extra ? ", " + extra.split("=")[0] : ""})
     values ('${VEH}', 'fuel', 1850.50, ${litres}, true, ${odo}${extra ? ", " + extra.split("=")[1] : ""}) returning logged_by`;
  // An entry the driver logged, today or yesterday (the guard is off for the back-dating; rolled back with the scenario).
  const logged = (daysAgo = 0) => ({
    setup: async () => {
      await vehicle();
      await client.query(`insert into ops.vehicle_expenses (id, vehicle_id, kind, amount, odometer, logged_by) values ($1, $2, 'change_oil', 2500, 1005, $3)`, [EXP, VEH, ids.driver]);
      if (daysAgo) {
        await client.query("alter table ops.vehicle_expenses disable trigger guard_vehicle_expense");
        await client.query(`update ops.vehicle_expenses set logged_at = now() - make_interval(days => $2) where id = $1`, [EXP, daysAgo]);
        await client.query("alter table ops.vehicle_expenses enable trigger guard_vehicle_expense");
      }
    },
  });
  const change = (reason = null) => q(`update ops.vehicle_expenses set amount = 2600, change_reason = $1 where id = '${EXP}'`, [reason]);
  const voidIt = (reason) => q(`update ops.vehicle_expenses set voided_at = now(), void_reason = $1 where id = '${EXP}' returning voided_by`, [reason]);
  const constraintFailed = (r) => !r.ok && r.code === "23514";

  await scenario(ids, "the driver logs a fill-up, stamped as theirs", "driver", { setup: () => vehicle() }, q(fill()), value("logged_by", ids.driver));
  await scenario(ids, "who logged it can't be written by hand", "driver", { setup: () => vehicle() }, q(fill("1010", "30", `logged_by='${ids.admin}'`)), value("logged_by", ids.driver));
  await scenario(ids, "fuel needs its litres", "driver", { setup: () => vehicle() }, q(fill("1010", "null")), constraintFailed);
  await scenario(ids, "fuel on a tracked vehicle needs the odometer", "driver", { setup: () => vehicle() }, q(fill("null")), badInput);
  await scenario(ids, "the pump reading can't be below the start", "driver", { setup: () => vehicle() }, q(fill("999")), badInput);
  await scenario(ids, "an expense can't be dated in the future", "driver", { setup: () => vehicle() },
    q(`insert into ops.vehicle_expenses (vehicle_id, kind, amount, expense_date) values ('${VEH}', 'car_wash', 150, current_date + 3)`), badInput);
  await scenario(ids, "paid by a driver names the driver", "driver", { setup: () => vehicle() },
    q(`insert into ops.vehicle_expenses (vehicle_id, kind, amount, paid_by) values ('${VEH}', 'parking_toll', 60, 'driver')`), constraintFailed);
  await scenario(ids, "house staff can't log an expense", "house_staff", { setup: () => vehicle() },
    q(`insert into ops.vehicle_expenses (vehicle_id, kind, amount) values ('${VEH}', 'car_wash', 150)`), denied);
  await scenario(ids, "finance reads the log", "finance", logged(), q(`select id from ops.vehicle_expenses where id = '${EXP}'`), rows(1));
  await scenario(ids, "a volunteer reads no expenses", "volunteer", logged(), q(`select id from ops.vehicle_expenses where id = '${EXP}'`), rows(0));
  await scenario(ids, "the driver changes their own entry the same day, on the record", "driver", logged(),
    last({ sql: `update ops.vehicle_expenses set amount = 2600 where id = '${EXP}'` },
      { sql: `select exists (select 1 from ops.vehicle_expense_changes where expense_id = $1 and (old_row->>'amount')::numeric = 2500 and (new_row->>'amount')::numeric = 2600) as ok`, params: [EXP] }),
    value("ok", true));
  await scenario(ids, "someone else can't change the driver's entry", "social_worker", logged(), change(), denied);
  await scenario(ids, "the driver can't change yesterday's entry", "driver", logged(1), change("forgot the tip"), denied);
  await scenario(ids, "the Super Admin needs a reason for yesterday's entry", "admin", logged(1), change(), badInput);
  await scenario(ids, "the Super Admin changes yesterday's entry with a reason, on the record", "admin", logged(1),
    last({ sql: `update ops.vehicle_expenses set amount = 2600, change_reason = 'receipt says 2,600' where id = '${EXP}'` },
      { sql: `select (select change_reason is null from ops.vehicle_expenses where id = $1)
                 and exists (select 1 from ops.vehicle_expense_changes where expense_id = $1 and reason = 'receipt says 2,600' and changed_by = $2) as ok`, params: [EXP, ids.admin] }),
    value("ok", true));
  await scenario(ids, "the driver voids their own entry the same day", "driver", logged(), voidIt("logged twice"), value("voided_by", ids.driver));
  await scenario(ids, "a void needs a reason", "driver", logged(), voidIt(" "), badInput);
  await scenario(ids, "a void is kept in the change history", "driver", logged(),
    last({ sql: `update ops.vehicle_expenses set voided_at = now(), void_reason = 'logged twice' where id = '${EXP}'` },
      { sql: `select exists (select 1 from ops.vehicle_expense_changes where expense_id = $1 and reason = 'Voided: logged twice') as ok`, params: [EXP] }),
    value("ok", true));
  await scenario(ids, "a voided entry stays as it is", "admin",
    { setup: async () => { await logged().setup(); await client.query(`update ops.vehicle_expenses set voided_at = now(), void_reason = 'logged twice' where id = $1`, [EXP]); } },
    change("undo"), denied);
  await scenario(ids, "nobody deletes an entry", "admin", logged(), q(`delete from ops.vehicle_expenses where id = '${EXP}'`), denied);
  await scenario(ids, "nobody writes the change history by hand", "admin", logged(),
    q(`insert into ops.vehicle_expense_changes (expense_id, old_row, new_row) values ('${EXP}', '{}', '{}')`), denied);
  await scenario(ids, "the Super Admin adds an expense type", "admin", null, q(`insert into ops.vehicle_expense_kinds (id, name) values ('vexp-rlstest', 'RLSTEST Type')`), rows(1));
  await scenario(ids, "a social worker can't add an expense type", "social_worker", null, q(`insert into ops.vehicle_expense_kinds (id, name) values ('vexp-rlstest', 'RLSTEST Type')`), denied);
  await scenario(ids, "Fuel can't be removed (0 rows)", "admin", null, q(`delete from ops.vehicle_expense_kinds where id = 'fuel'`), rows(0));
  await scenario(ids, "drivers add receipts to Transport", "driver", null, q(`select shared.file_write_allowed('transport') as ok`), value("ok", true));
  await scenario(ids, "house staff don't add receipts", "house_staff", null, q(`select shared.file_write_allowed('transport') as ok`), value("ok", false));
  await scenario(ids, "only the Super Admin removes a receipt", "driver", null, q(`select shared.file_delete_allowed('transport') as ok`), value("ok", false));
  await scenario(ids, "the Super Admin removes a receipt", "admin", null, q(`select shared.file_delete_allowed('transport') as ok`), value("ok", true));
  await scenario(ids, "finance reads the receipts", "finance", null, q(`select shared.file_read_allowed('transport', 'vehicle_expense', null) as ok`), value("ok", true));


  // --- 0078: odometer photos and the usual km --------------------------------------------
  const PHOTO = "00000000-0000-4000-8000-0000000000f7";
  const VEH2 = "00000000-0000-4000-8000-0000000000e7";
  await scenario(ids, "the day's first departure needs an odometer photo", "driver",
    { setup: async () => { await vehicle(1000, false); await vtrip(T2); } },
    depart(1000), (r) => badInput(r) && /photo of the odometer/.test(r.msg));
  await scenario(ids, "with today's photo in, the next departure goes", "driver", tracked(), depart(1000), value("odometer_start", 1000));
  await scenario(ids, "a departure is backed by its photo", "driver",
    { setup: async () => { await vehicle(1000, false); await client.query(odoPhoto(VEH, PHOTO)); await vtrip(T2); } },
    q(`update ops.trips set status = 'in_progress', odometer_start = 1000, start_photo_id = '${PHOTO}' where id = '${T2}' returning start_photo_id`), value("start_photo_id", PHOTO));
  await scenario(ids, "a photo of another vehicle can't back a reading", "driver",
    { setup: async () => {
      await vehicle();
      await client.query(`insert into ops.vehicles (id, name) values ($1, 'RLSTEST Other')`, [VEH2]);
      await client.query(odoPhoto(VEH2, PHOTO));
      await vtrip(T2);
    } },
    q(`update ops.trips set status = 'in_progress', odometer_start = 1000, start_photo_id = '${PHOTO}' where id = '${T2}'`), badInput);
  await scenario(ids, "'Not left yet' lets go of the photo too", "driver",
    { setup: async () => {
      await vehicle(1000, false);
      await client.query(odoPhoto(VEH, PHOTO));
      await vtrip(T2);
      await client.query(`update ops.trips set status = 'in_progress', odometer_start = 1000, start_photo_id = $2 where id = $1`, [T2, PHOTO]);
    } },
    q(`update ops.trips set status = 'scheduled' where id = '${T2}' returning start_photo_id is null as ok`), value("ok", true));
  await scenario(ids, "nobody files an odometer photo by hand", "driver", { setup: () => vehicle() }, q(odoPhoto(VEH)), denied);
  await scenario(ids, "the driver reads the vehicle's photos", "driver", { setup: () => vehicle() },
    q(`select id from ops.odometer_photos where vehicle_id = '${VEH}'`), rows(1));
  await scenario(ids, "a volunteer reads no odometer photos", "volunteer", { setup: () => vehicle() },
    q(`select id from ops.odometer_photos where vehicle_id = '${VEH}'`), rows(0));
  await scenario(ids, "an NCH pick-up's route is 'pickup'", "driver", null, q(`select ops.route_key('from_hospital', null) as k`), value("k", "pickup"));
  await scenario(ids, "the usual km is the middle of the route's trips", "driver",
    { setup: async () => {
      await vehicle();
      let odo = 1000;
      for (const [i, km] of [20, 24, 30].entries()) {
        const id = `00000000-0000-4000-8000-0000000000a${i}`;
        await vtrip(id, "completed", odo, odo + km);
        odo += km;
      }
    } },
    q(`select trips, median_km from ops.v_route_km where route_key = 'errand:test errand'`),
    (r) => r.ok && r.rows === 1 && r.data[0].trips === 3 && Number(r.data[0].median_km) === 24);

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
