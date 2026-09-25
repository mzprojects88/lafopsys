// Proves 0053 (LAF HOPE pick-ups: the manifest, on-board ticks, trip progress,
// an arrival naming its trip, the 'transport' module) against the live
// database, one scenario per transaction, every transaction rolled back. Same
// harness as scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1
// acknowledges that lafopsys has one database.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/pickup-matrix.mjs
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
});

const ROLES = ["admin", "social_worker", "house_staff", "driver", "volunteer"];
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
// A scheduled LAF HOPE trip for both, made directly.
const trip = async (status = "scheduled") => {
  await client.query(
    `insert into ops.trips (id, date, direction, vehicle, departure_time, status) values ($1, ${TODAY}, 'from_hospital', 'LAF HOPE Transport', '07:30', 'scheduled')`,
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
