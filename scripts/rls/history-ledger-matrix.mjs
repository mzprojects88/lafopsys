// Proves 0167 (Patients > History: past nights, beds, meals and rides, complete days) against the database,
// one scenario per transaction, every transaction rolled back. Same harness as patient-cards-matrix.mjs.
// In pre-flight it also proves that applying 0167 alone leaves every report figure as it was: the Programs
// report rows, the nightly record (NCH billing reads it) and the meal record, before and after, identical.
//
// Usage:      RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/history-ledger-matrix.mjs
// Pre-flight: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/history-ledger-matrix.mjs supabase/migrations/0167_history_ledger.sql
import { pgUrl } from "../lib/db-url.mjs";
import { Client } from "pg";
import { readFile } from "node:fs/promises";

if (process.env.RLS_ALLOW_PROD !== "1") {
  console.error("This targets the database named in the env file (rolled back per scenario). Set RLS_ALLOW_PROD=1 to run.");
  process.exit(1);
}
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD.");
  process.exit(1);
}
const client = new Client({ connectionString: pgUrl(password), query_timeout: 180000 });

const ROLES = ["admin", "social_worker", "office_admin", "house_staff", "ceo", "driver"];
const results = [];
const record = (name, verdict, detail = "") => results.push({ scenario: name, result: verdict, detail: String(detail).replace(/\s+/g, " ").slice(0, 100) });

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
  const { rows: spare } = await client.query(`select id from shared.staff where staff_code like 'RLSTEST-%' and role not in ('admin') order by created_at limit 1`);
  for (const role of ROLES) if (!ids[role] && spare[0]) ids[role] = spare[0].id;
  return ids;
}
const claims = (id) => JSON.stringify({ sub: id, role: "authenticated" });
const PREFLIGHT = process.argv.slice(2);

const KID = "00000000-0000-4000-8000-0000000167a1";
const OTHER = "00000000-0000-4000-8000-0000000167a2";
const CAF = "00000000-0000-4000-8000-0000000167a3";
const MOM = "00000000-0000-4000-8000-0000000167c1";
const AUNT = "00000000-0000-4000-8000-0000000167c2";
const TODAY = "(now() at time zone 'Asia/Manila')::date";
const D = `(${TODAY} - 3)`; // within the note days
const OLD = `(${TODAY} - 20)`; // a note is needed
const FAR = `(${TODAY} - 70)`; // beyond the 60-day back-limit: admins only

// Beds of the matrix's own: HX1 holds one child, HX2 two.
const seed = async () => {
  const room = (await client.query("select id from ops.rooms order by sort_order limit 1")).rows[0].id;
  await client.query(
    `insert into ops.units (id, code, room_id, status, shared_unit, capacity, active, w, h) values
       ('unit-HX1', 'HX1', '${room}', 'available', false, 1, true, 0.05, 0.1),
       ('unit-HX2', 'HX2', '${room}', 'available', true, 2, true, 0.05, 0.1);
     insert into ops.bed_positions (id, unit_id, label) values ('unit-HX1-A', 'unit-HX1', 'A'), ('unit-HX2-A', 'unit-HX2', 'A'), ('unit-HX2-B', 'unit-HX2', 'B');
     insert into ops.patients (id, first_name, last_name, sex, status, admitted_at, caf_billing) values
       ('${KID}', 'Hist', 'Child', 'F', 'ongoing', current_date - 90, false),
       ('${OTHER}', 'Hist', 'Other', 'M', 'ongoing', current_date - 90, false),
       ('${CAF}', 'Hist', 'Caf', 'F', 'ongoing', current_date - 90, true);
     insert into ops.carers (id, patient_id, name, relationship, effective_from, sex) values
       ('${MOM}', '${KID}', 'Hist Mother', 'Mother', current_date - 90, 'F'),
       ('${AUNT}', '${KID}', 'Hist Aunt', 'Aunt', current_date - 90, 'F')`
  );
};

async function scenario(ids, name, actor, setup, body, expect) {
  if (actor && !ids[actor]) return record(name, "SKIP", `no ${actor} account`);
  await client.query(PREFLIGHT.length ? "savepoint scenario" : "begin");
  try {
    if (actor) await client.query("update shared.staff set active = true, role = $2 where id = $1", [ids[actor], actor]);
    // The role is under test, not a person's own overrides (0091).
    if (actor) await client.query("delete from shared.staff_module_access where staff_id = $1", [ids[actor]]);
    // The back-limit and note days at their defaults, whatever the database holds.
    await client.query("update shared.app_settings set meals_back_days = 60, history_note_days = 7 where id");
    await seed();
    if (ids.admin) {
      await client.query("update shared.staff set active = true where id = $1", [ids.admin]);
      await client.query("select set_config('request.jwt.claims', $1, true)", [claims(ids.admin)]);
    }
    if (setup) await setup();
    await client.query(actor ? "set local role authenticated" : "set local role anon");
    if (actor) await client.query("select set_config('request.jwt.claims', $1, true)", [claims(ids[actor])]);
    else await client.query("select set_config('request.jwt.claims', '', true)");
    let outcome;
    try {
      const r = await body();
      outcome = { ok: true, rows: r.rowCount, data: r.rows };
    } catch (e) {
      outcome = { ok: false, code: e.code, msg: e.message, hint: e.hint };
    }
    record(name, expect(outcome) ? "PASS" : "FAIL", outcome.ok ? `ok ${JSON.stringify(outcome.data?.[0] ?? "")}` : `${outcome.code} ${outcome.msg}`);
  } catch (e) {
    record(name, "FAIL", `setup error: ${e.message}`);
  } finally {
    await client.query(PREFLIGHT.length ? "rollback to savepoint scenario" : "rollback");
  }
}

const denied = (r) => !r.ok && r.code === "42501";
const bad = (r) => !r.ok && r.code === "22023";
const q = (sql) => () => client.query(sql);
const steps = (...sqls) => async () => {
  let r;
  for (const s of sqls) r = await client.query(s);
  return r;
};
const night = (kid, day, unit, extra = "") => `select ops.history_save_night(${day}, '${kid}', 'unit-${unit}'${extra}) as r`;
const meals = (kids, day, list, on, note = "null") => `select ops.history_set_meals(${day}, array[${kids.map((k) => `'${k}'`).join(",")}]::uuid[], array[${list.map((m) => `'${m}'`).join(",")}], ${on}, ${note}) as n`;
const rides = (kids, day, dir, on, extra = "") => `select ops.history_set_rides(${day}, array[${kids.map((k) => `'${k}'`).join(",")}]::uuid[], '${dir}', ${on}${extra}) as n`;
const asAdmin = (...sqls) => async () => {
  for (const s of sqls) await client.query(s);
};

// The report figures, as one fingerprint each (run as postgres).
async function fingerprints(adminId) {
  const one = async (sql) => (await client.query(sql)).rows[0].f;
  // Reports' occupancy needs a Reports viewer: read as the admin.
  if (adminId) await client.query("update shared.staff set active = true where id = $1", [adminId]); // inside the pre-flight transaction
  if (adminId) await client.query("select set_config('request.jwt.claims', $1, false)", [claims(adminId)]);
  const extra = adminId ? await one(`select md5(ops.report_extra(date '2026-01-01', ${TODAY})::text) f`) : null;
  if (adminId) await client.query("select set_config('request.jwt.claims', '', false)");
  return {
    occupancy: extra,
    programs: await one(`select md5(string_agg(line || bucket || ':' || native || '/' || from_sheet, ',' order by line, bucket)) f
                           from ops.program_impact_range_rows(date '2026-01-01', ${TODAY}, 'day')`),
    nights: await one(`select md5(string_agg(concat_ws('|', patient_id, night, source, bed_position_id, carer_name, visit_key, visit_start), ',' order by patient_id, night, source, visit_key)) f from ops.nightly_record`),
    meals: await one(`select md5(string_agg(concat_ws('|', patient_id, date, meal, people, source), ',' order by patient_id, date, meal, source)) f from ops.meal_record`),
  };
}

async function main() {
  await client.connect();
  const ids = await accountIds();
  if (PREFLIGHT.length) {
    await client.query("begin");
    const before = await fingerprints(ids.admin);
    const programsBefore = (await client.query(`select line, bucket::text, native::text, from_sheet::text from ops.program_impact_range_rows(date '2026-01-01', ${TODAY}, 'day')`)).rows;
    for (const file of PREFLIGHT) {
      await client.query(await readFile(file, "utf8"));
      console.log("pre-flight applied (rolled back at the end):", file);
    }
    const after = await fingerprints(ids.admin);
    for (const k of Object.keys(before)) record(`applying ${PREFLIGHT.map((p) => p.match(/(\d{4})_/)?.[1]).join(" + ")} leaves the ${k} figures as they were`, before[k] === after[k] ? "PASS" : "FAIL", `${before[k]} -> ${after[k]}`);
    if (before.programs !== after.programs) {
      const now = new Map((await client.query(`select line, bucket::text, native::text, from_sheet::text from ops.program_impact_range_rows(date '2026-01-01', ${TODAY}, 'day')`)).rows.map((r) => [`${r.line} ${r.bucket}`, r]));
      for (const r of programsBefore) {
        const n = now.get(`${r.line} ${r.bucket}`);
        if (!n || n.native !== r.native || n.from_sheet !== r.from_sheet) console.log("moved:", r.line, r.bucket, `${r.native}/${r.from_sheet} -> ${n?.native}/${n?.from_sheet}`);
      }
    }
  }
  console.log("Acting accounts:", Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v ? "yes" : "none"])));

  // ---- nights ----
  await scenario(ids, "a social worker adds a past night: a one-night stay closed the next morning", "social_worker", null,
    steps(night(KID, D, "HX1", `, '${MOM}'`),
      `select s.status, s.check_out_reason, s.check_in_at = ${D} as d_in, s.check_out_at = ${D} + 1 as d_out, s.from_history, s.carer_id::text, s.visit_id = s.id as own_visit,
              (select count(*)::int from ops.bed_nights b where b.stay_id = s.id and b.night = ${D}) as nights
         from ops.stays s where s.patient_id = '${KID}'`),
    (r) => r.ok && r.rows === 1 && r.data[0].status === "checked_out" && r.data[0].check_out_reason === "daily_reset" && r.data[0].d_in && r.data[0].d_out && r.data[0].from_history && r.data[0].carer_id === MOM && r.data[0].own_visit && r.data[0].nights === 1);
  await scenario(ids, "the office admin (Patients edit) adds one too", "office_admin", null, q(night(KID, D, "HX1")), (r) => r.ok && r.data[0].r.added === true);
  await scenario(ids, "a bed holds one child a night", "social_worker", asAdmin(night(KID, D, "HX1")), q(night(OTHER, D, "HX1")), (r) => !r.ok && r.code === "23505");
  await scenario(ids, "...a double bed two", "social_worker", asAdmin(night(KID, D, "HX2")),
    steps(night(OTHER, D, "HX2"), `select count(*)::int as n from ops.bed_nights b where b.night = ${D} and b.bed_position_id like 'unit-HX2-%'`),
    (r) => r.ok && r.data[0].n === 2);
  await scenario(ids, "saving again moves the bed, carer and people: still one night", "social_worker", asAdmin(night(KID, D, "HX1", `, '${MOM}'`)),
    steps(night(KID, D, "HX2", `, '${AUNT}', 3::smallint`),
      `select (select count(*)::int from ops.bed_nights b join ops.stays s on s.id = b.stay_id where s.patient_id = '${KID}') as nights,
              (select bp.unit_id from ops.bed_nights b join ops.stays s on s.id = b.stay_id join ops.bed_positions bp on bp.id = b.bed_position_id where s.patient_id = '${KID}') as unit,
              (select carer_id::text from ops.stays where patient_id = '${KID}') as carer, (select people_with_child from ops.stays where patient_id = '${KID}') as people`),
    (r) => r.ok && r.data[0].nights === 1 && r.data[0].unit === "unit-HX2" && r.data[0].carer === AUNT && r.data[0].people === 3);
  await scenario(ids, "nights in a row are one visit, whatever order they are entered in", "social_worker", null,
    steps(night(KID, D, "HX1"), night(KID, `${D} - 2`, "HX1"), night(KID, `${D} - 1`, "HX1"),
      `select count(distinct coalesce(visit_id, id))::int as visits, count(*)::int as stays from ops.stays where patient_id = '${KID}'`),
    (r) => r.ok && r.data[0].visits === 1 && r.data[0].stays === 3);
  await scenario(ids, "a past night is never joined to last night's real visit", "social_worker",
    // A real stay closed by this morning's reset.
    () => client.query(`insert into ops.stays (patient_id, bed_position_id, check_in_at, check_out_at, check_out_reason, status) values ('${KID}', 'unit-HX2-A', ${TODAY} - 1, ${TODAY}, 'daily_reset', 'checked_out')`),
    steps(night(KID, OLD, "HX1", ", null, null, 'From the House Sheet'"), `select count(distinct coalesce(visit_id, id))::int as visits from ops.stays where patient_id = '${KID}'`),
    (r) => r.ok && r.data[0].visits === 2);
  await scenario(ids, "today belongs to House Today", "social_worker", null, q(night(KID, TODAY, "HX1")), bad);
  await scenario(ids, "a day more than 7 days back needs a note", "social_worker", null, q(night(KID, OLD, "HX1")), bad);
  await scenario(ids, "...and saves with one, kept in the trail", "social_worker", null,
    steps(night(KID, OLD, "HX1", ", null, null, 'From the House Sheet'"), `select note, action from ops.history_edits where patient_id = '${KID}'`),
    (r) => r.ok && r.data[0].note === "From the House Sheet" && r.data[0].action === "night_added");
  await scenario(ids, "beyond 60 days back a social worker is refused", "social_worker", null, q(night(KID, FAR, "HX1", ", null, null, 'x'")), denied);
  await scenario(ids, "...an admin may", "admin", null, q(night(KID, FAR, "HX1", ", null, null, 'Late paper record'")), (r) => r.ok && r.data[0].r.added === true);
  await scenario(ids, "a driver cannot record nights", "driver", null, q(night(KID, D, "HX1")), denied);
  await scenario(ids, "house staff cannot", "house_staff", null, q(night(KID, D, "HX1")), denied);
  await scenario(ids, "the CEO (view only) cannot", "ceo", null, q(night(KID, D, "HX1")), denied);
  await scenario(ids, "a carer of another child is refused", "social_worker", null, q(night(OTHER, D, "HX1", `, '${MOM}'`)), bad);
  await scenario(ids, "a night still open on House Today is not changed here", "social_worker",
    () => client.query(`with s as (insert into ops.stays (patient_id, bed_position_id, check_in_at, status) values ('${KID}', 'unit-HX1-A', ${D}, 'in_house') returning id)
                        insert into ops.bed_nights (night, stay_id, bed_position_id) select ${D}, id, 'unit-HX1-A' from s`),
    q(night(KID, D, "HX2")), (r) => !r.ok && r.code === "55000");
  await scenario(ids, "a past night does not close the family's bed hold", "social_worker",
    () => client.query(`insert into ops.bed_reservations (unit_id, patient_id, reserved_for, expected_on, status, carer_sex) values ('unit-HX2', '${KID}', 'Hist Child', ${TODAY} + 1, 'active', 'F')`),
    steps(night(KID, D, "HX1"), `select status from ops.bed_reservations where patient_id = '${KID}'`), (r) => r.ok && r.data[0].status === "active");

  // ---- removing nights ----
  await scenario(ids, "removing a night made here removes its stay and that day's meals", "social_worker",
    asAdmin(night(KID, D, "HX1"), meals([KID], D, ["breakfast", "dinner"], true)),
    steps(`select ops.history_remove_nights(${D}, array['${KID}']::uuid[]) as n`,
      `select (select count(*)::int from ops.stays where patient_id = '${KID}') as stays, (select count(*)::int from ops.meals_served where patient_id = '${KID}') as meals`),
    (r) => r.ok && r.data[0].stays === 0 && r.data[0].meals === 0);
  await scenario(ids, "...but keeps them when the night before covers the day (breakfast before leaving)", "social_worker",
    asAdmin(night(KID, `${D} - 1`, "HX1"), night(KID, D, "HX1"), meals([KID], D, ["breakfast"], true)),
    steps(`select ops.history_remove_nights(${D}, array['${KID}']::uuid[]) as n`, `select count(*)::int as meals from ops.meals_served where patient_id = '${KID}'`),
    (r) => r.ok && r.data[0].meals === 1);
  await scenario(ids, "removing a night of an older stay leaves the stay itself", "social_worker",
    () => client.query(`with s as (insert into ops.stays (patient_id, bed_position_id, check_in_at, check_out_at, check_out_reason, status) values ('${KID}', 'unit-HX1-A', ${D} - 1, ${D} + 1, 'completed_treatment', 'checked_out') returning id)
                        insert into ops.bed_nights (night, stay_id, bed_position_id) select n, id, 'unit-HX1-A' from s, (values (${D} - 1), (${D})) v(n)`),
    steps(`select ops.history_remove_nights(${D}, array['${KID}']::uuid[]) as n`,
      `select (select count(*)::int from ops.stays where patient_id = '${KID}') as stays, (select count(*)::int from ops.bed_nights b join ops.stays s on s.id = b.stay_id where s.patient_id = '${KID}') as nights`),
    (r) => r.ok && r.data[0].stays === 1 && r.data[0].nights === 1);

  // ---- meals ----
  await scenario(ids, "meals for several children at once", "social_worker", asAdmin(night(KID, D, "HX2"), night(OTHER, D, "HX2")),
    steps(meals([KID, OTHER], D, ["breakfast", "lunch", "dinner"], true), `select count(*)::int as n from ops.meals_served where date = ${D} and patient_id in ('${KID}', '${OTHER}')`),
    (r) => r.ok && r.data[0].n === 6);
  await scenario(ids, "a meal needs a night that covers the day", "social_worker", null, q(meals([KID], D, ["lunch"], true)), bad);
  await scenario(ids, "breakfast the morning after the last night is fine", "social_worker", asAdmin(night(KID, `${D} - 1`, "HX1")), q(meals([KID], D, ["breakfast"], true)), (r) => r.ok && r.data[0].n === 1);
  await scenario(ids, "meals off again", "social_worker", asAdmin(night(KID, D, "HX1"), meals([KID], D, ["breakfast", "lunch"], true)),
    steps(meals([KID], D, ["lunch"], false), `select string_agg(meal, ',') as m from ops.meals_served where patient_id = '${KID}'`), (r) => r.ok && r.data[0].m === "breakfast");
  await scenario(ids, "a driver never records meals", "driver", asAdmin(night(KID, D, "HX1")), q(meals([KID], D, ["lunch"], true)), denied);
  await scenario(ids, "house staff do not record past meals here", "house_staff", asAdmin(night(KID, D, "HX1")), q(meals([KID], D, ["lunch"], true)), denied);
  await scenario(ids, "only breakfast, lunch and dinner", "social_worker", asAdmin(night(KID, D, "HX1")), q(meals([KID], D, ["snack"], true)), bad);
  await scenario(ids, "more than 40 children at once is refused", "social_worker", null,
    q(`select ops.history_set_meals(${D}, array(select gen_random_uuid() from generate_series(1, 41)), array['lunch'], true) as n`), bad);

  // ---- rides ----
  await scenario(ids, "a past ride with no trip that day makes one, entered in History, with no odometer", "social_worker", null,
    steps(rides([KID, OTHER], D, "to_hospital", true),
      `select t.status, t.from_history, t.vehicle_id is null as no_vehicle, t.odometer_start is null as no_km, (select count(*)::int from ops.trip_passengers where trip_id = t.id) as riders,
              (select sum(people)::int from ops.trip_passengers where trip_id = t.id) as people
         from ops.trips t where t.date = ${D} and t.from_history`),
    (r) => r.ok && r.rows === 1 && r.data[0].status === "completed" && r.data[0].from_history && r.data[0].no_vehicle && r.data[0].no_km && r.data[0].riders === 2 && r.data[0].people === 4);
  await scenario(ids, "a rider joins the day's real trip that way when there is one", "social_worker",
    () => client.query(`insert into ops.trips (date, direction, vehicle, departure_time, status, carries_passengers) values (${D}, 'from_hospital', 'Test van', '08:00', 'scheduled', true)`),
    steps(rides([KID], D, "from_hospital", true, ", 3::smallint"), `select count(*)::int as trips, bool_and(not from_history) as real from ops.trips where date = ${D} and id in (select trip_id from ops.trip_passengers where patient_id = '${KID}')`),
    (r) => r.ok && r.data[0].trips === 1 && r.data[0].real === true);
  await scenario(ids, "taking the last rider off a History trip removes the trip", "social_worker", asAdmin(rides([KID], D, "to_hospital", true)),
    steps(rides([KID], D, "to_hospital", false), `select count(*)::int as n from ops.trips where date = ${D} and from_history`), (r) => r.ok && r.data[0].n === 0);
  await scenario(ids, "a driver records a past ride: the History trip is theirs", "driver", null,
    steps(rides([KID], D, "to_hospital", true), `select (driver_staff_id = auth.uid()) as mine from ops.trips where date = ${D} and from_history`), (r) => r.ok && r.data[0].mine === true);
  await scenario(ids, "...but not onto another driver's trip", "driver",
    () => client.query(`insert into ops.trips (id, date, direction, vehicle, departure_time, status, carries_passengers) values ('00000000-0000-4000-8000-0000000167e1', ${D}, 'to_hospital', 'Test van', '08:00', 'scheduled', true)`),
    q(rides([KID], D, "to_hospital", true, ", 2::smallint, '00000000-0000-4000-8000-0000000167e1'")), denied);
  await scenario(ids, "house staff (Transport view) cannot record rides", "house_staff", null, q(rides([KID], D, "to_hospital", true)), denied);
  await scenario(ids, "an errand is not a ride", "social_worker", null, q(rides([KID], D, "errand", true)), bad);

  // ---- complete days and the reports ----
  const sheetNames = () =>
    client.query(`insert into ops.sheet_nights (night, name_key, patient_name) values (${D}, 'zz-hist-1', 'Sheet One'), (${D}, 'zz-hist-2', 'Sheet Two');
                  insert into ops.house_sheet_people (name_key, patient_name, first_seen_on, last_seen_on, run_started_on, match_status, matched_patient_id)
                  values ('zz-hist-1', 'Sheet One', ${D}, ${D}, ${D}, 'confirmed', '${OTHER}')`);
  await scenario(ids, "completing a day with fewer children than the House Sheet asks to confirm", "social_worker",
    async () => { await sheetNames(); await client.query(night(KID, D, "HX1")); },
    q(`select ops.history_complete_day(${D}, true) as r`), (r) => !r.ok && r.code === "P0001" && r.hint === "fewer");
  await scenario(ids, "...confirmed with a note, the day is complete", "social_worker",
    async () => { await sheetNames(); await client.query(night(KID, D, "HX1")); },
    steps(`select ops.history_complete_day(${D}, true, 'One family left before the sheet was updated', true) as r`, `select count(*)::int as n from ops.history_days where day = ${D}`),
    (r) => r.ok && r.data[0].n === 1);
  await scenario(ids, "a complete day is the app's in the nightly record (NCH billing) and the meal record", "social_worker",
    async () => {
      await client.query(night(KID, D, "HX1"));
      await client.query(meals([KID], D, ["lunch"], true));
      await client.query(`insert into ops.sheet_meals (date, name_key, patient_name, bn, breakfast, lunch, dinner) values (${D}, 'zz-hist-1', 'Sheet One', 2, 2, 2, 2)`);
      await client.query(`select ops.history_complete_day(${D}, true, 'matrix', true) as r`);
    },
    q(`select (select string_agg(distinct source, ',') from ops.nightly_record where night = ${D}) as nights,
              (select string_agg(distinct source, ',') from ops.meal_record where date = ${D}) as meals`),
    (r) => r.ok && r.data[0].nights === "app" && r.data[0].meals === "app");
  await scenario(ids, "...and the Programs report counts it from the app in both columns", "social_worker",
    async () => {
      await client.query(night(KID, D, "HX1", ", null, 1::smallint"));
      await client.query(`insert into ops.sheet_meals (date, name_key, patient_name, bn, breakfast, lunch, dinner) values (${D}, 'zz-hist-1', 'Sheet One', 9, 0, 0, 0)`);
      await client.query(`select ops.history_complete_day(${D}, true, 'matrix', true) as r`);
    },
    // The report's own gate needs Reports access: read the rows as the owner.
    steps("reset role", `select native::int, from_sheet::int from ops.program_impact_range_rows(${D}, ${D}, 'day') where line = 'housing'`),
    (r) => r.ok && r.data[0].native >= 2 && r.data[0].from_sheet === r.data[0].native);
  await scenario(ids, "a day can be reopened", "social_worker", asAdmin(`select ops.history_complete_day(${D}, true, 'matrix', true) as r`),
    steps(`select ops.history_complete_day(${D}, false) as r`, `select count(*)::int as n from ops.history_days where day = ${D}`), (r) => r.ok && r.data[0].n === 0);
  await scenario(ids, "a driver cannot complete a day", "driver", null, q(`select ops.history_complete_day(${D}, true) as r`), denied);
  await scenario(ids, "a final NCH bill locks its month for NCH-billed children", "social_worker",
    () => client.query(`insert into ops.caf_billings (month, rate, cap, discount_pct, status, finalised_at) values (date_trunc('month', ${D})::date, 500, 15, 0, 'final', now())`),
    q(night(CAF, D, "HX1")), denied);
  await scenario(ids, "...and its days cannot be completed", "social_worker",
    () => client.query(`insert into ops.caf_billings (month, rate, cap, discount_pct, status, finalised_at) values (date_trunc('month', ${D})::date, 500, 15, 0, 'final', now())`),
    q(`select ops.history_complete_day(${D}, true) as r`), denied);

  // ---- reading ----
  await scenario(ids, "the day as a social worker: bed, carer, meals, rides, the sheet's people and the beds", "social_worker",
    async () => { await sheetNames(); await client.query(night(KID, D, "HX1", `, '${MOM}'`)); await client.query(meals([KID], D, ["lunch"], true)); await client.query(rides([KID], D, "to_hospital", true)); },
    q(`select ops.history_day(${D}) as d`),
    (r) => {
      const d = r.ok && r.data[0].d;
      const kid = d && d.rows.find((x) => x.patientId === KID);
      return !!kid && kid.night?.unitCode === "HX1" && kid.night?.carerId === MOM && kid.meals.includes("lunch") && !!kid.rides.to_hospital && d.sheet.some((x) => x.nameKey === 'zz-hist-1' && x.patientId === OTHER) && d.beds.some((b) => b.code === "HX1" && b.taken === 1) && d.canNights === true;
    });
  await scenario(ids, "the day as a driver: names and rides only", "driver",
    async () => { await sheetNames(); await client.query(night(KID, D, "HX1", `, '${MOM}'`)); await client.query(meals([KID], D, ["lunch"], true)); },
    q(`select ops.history_day(${D}) as d`),
    (r) => {
      const d = r.ok && r.data[0].d;
      const kid = d && d.rows.find((x) => x.patientId === KID);
      return !!kid && kid.night === null && kid.meals === null && kid.carers === null && kid.stayed === true && d.sheet.length === 0 && d.beds.length === 0 && d.canNights === false && d.canRides === true;
    });
  await scenario(ids, "the month: the app's and the sheet's counts per day", "social_worker",
    async () => { await sheetNames(); await client.query(night(KID, D, "HX1")); },
    q(`select app_children, sheet_children, completed from ops.history_month(${D}, ${D})`),
    (r) => r.ok && r.data[0].app_children >= 1 && r.data[0].sheet_children >= 2 && r.data[0].completed === false);
  await scenario(ids, "house staff (no Patients or Transport access) cannot read history", "house_staff", null, q(`select ops.history_day(${D}) as d`), denied);
  await scenario(ids, "a driver reading the trail directly sees ride entries only", "driver",
    async () => { await client.query(night(KID, D, "HX1", ", null, null, 'family note'")); await client.query(rides([KID], D, "to_hospital", true)); },
    q(`select string_agg(distinct action, ',') as a from ops.history_edits where day = ${D}`), (r) => r.ok && r.data[0].a === "ride_added");
  await scenario(ids, "nobody writes complete days directly", "admin", null, q(`insert into ops.history_days (day) values (${D})`), denied);
  await scenario(ids, "nobody writes the trail directly", "admin", null, q(`insert into ops.history_edits (day, action) values (${D}, 'x')`), denied);
  await scenario(ids, "without a sign-in nothing runs", null, null, q(`select ops.history_day(${D}) as d`), denied);
  await scenario(ids, "nobody marks a real stay as entered in History", "social_worker",
    () => client.query(`insert into ops.stays (id, patient_id, bed_position_id, check_in_at, check_out_at, check_out_reason, status) values ('00000000-0000-4000-8000-0000000167f1', '${KID}', 'unit-HX1-A', ${D}, ${D} + 1, 'daily_reset', 'checked_out')`),
    q(`update ops.stays set from_history = true where id = '00000000-0000-4000-8000-0000000167f1'`), (r) => denied(r) || (r.ok && r.rows === 0));
  await scenario(ids, "...nor a real trip", "driver",
    () => client.query(`insert into ops.trips (id, date, direction, vehicle, departure_time, status, carries_passengers, driver_staff_id) values ('00000000-0000-4000-8000-0000000167e2', ${D}, 'to_hospital', 'Test van', '08:00', 'scheduled', true, auth.uid())`),
    q(`update ops.trips set from_history = true where id = '00000000-0000-4000-8000-0000000167e2'`), (r) => denied(r) || (r.ok && r.rows === 0));
  await scenario(ids, "the complete days are not readable by a non-staff session", "admin",
    async () => { await client.query(`insert into ops.history_days (day) values (${D})`); await client.query("update shared.staff set active = false where id = $1", [ids.admin]); },
    q(`select count(*)::int as n from ops.history_days`), (r) => r.ok && r.data[0].n === 0);

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
