// Proves 0065 (beds reserved before a child arrives; the house rules heard
// once by a group that arrived together) against the live database, one
// scenario per transaction, every transaction rolled back. Same harness as
// scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1 acknowledges
// that lafopsys has one database.
//
// 0066 (replacement) scenarios need 0066 applied, or passed as a pre-flight file.
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/bed-reservation-matrix.mjs
// Pre-flight: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/bed-reservation-matrix.mjs supabase/migrations/0065_bed_reservations_and_group_orientation.sql
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
const value = (field, v) => (r) => r.ok && r.rows === 1 && r.data[0][field] === v;

const q = (sql, params) => () => client.query(sql, params);
const last = (...steps) => async () => {
  let r;
  for (const s of steps) r = await client.query(s.sql, s.params);
  return r;
};
const PREFLIGHT = process.argv.slice(2);

// Fixtures: a child on file, a free bed, a LAF HOPE trip today.
const KID = "00000000-0000-4000-8000-00000000d065";
const KID2 = "00000000-0000-4000-8000-00000000d066";
const TRIP = "00000000-0000-4000-8000-00000000e065";
const TODAY = "(now() at time zone 'Asia/Manila')::date";
const seed = async () => {
  await client.query("update ops.units set status = 'available', lock_reason = null where id = 'unit-B1'");
  await client.query(`insert into ops.patients (id, first_name, last_name, sex, status, admitted_at) values ($1, 'Held', 'Bed', 'M', 'ongoing', current_date)`, [KID]);
  await client.query(`insert into ops.patients (id, first_name, last_name, sex, status, admitted_at) values ($1, 'Other', 'Kid', 'F', 'ongoing', current_date)`, [KID2]);
  await client.query(
    `insert into ops.trips (id, date, direction, vehicle, departure_time, status) values ($1, ${TODAY}, 'from_hospital', 'LAF HOPE Transport', '07:30', 'scheduled')`,
    [TRIP]
  );
};
const hold = (status = "active") =>
  client.query(
    `insert into ops.bed_reservations (unit_id, patient_id, reserved_for, expected_on, status, closed_at)
     values ('unit-B1', $1, 'Held Bed', ${TODAY}, $2, case when $2 = 'active' then null else now() end)`,
    [KID, status]
  );
const withSeed = (extra) => ({ setup: async () => { await seed(); if (extra) await extra(); } });
const withHold = withSeed(() => hold());
const reserveSql = `insert into ops.bed_reservations (unit_id, patient_id, reserved_for, expected_on) values ('unit-B1', '${KID}', 'Held Bed', ${TODAY}) returning created_by = auth.uid() as mine`;
const asOwner = (sql) => async () => { await client.query("reset role"); return client.query(sql); };

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

  // ---- bed reservations ----
  await scenario(ids, "social workers reserve a bed (stamped as theirs)", "social_worker", withSeed(), q(reserveSql), value("mine", true));
  await scenario(ids, "house staff cannot reserve (no Patients edit)", "house_staff", withSeed(), q(reserveSql), denied);
  await scenario(ids, "drivers see held beds on the plan (House view)", "driver", withHold, q("select id from ops.bed_reservations where patient_id = $1", [KID]), rows(1));
  await scenario(ids, "one held bed per child", "social_worker", withHold, q(reserveSql), duplicate);
  await scenario(ids, "a hold names a child or a sheet line", "admin", withSeed(),
    asOwner(`insert into ops.bed_reservations (unit_id, reserved_for, expected_on) values ('unit-B1', 'Nobody', ${TODAY})`), checkFailed);
  await scenario(ids, "a hold cannot be inserted already closed", "social_worker", withSeed(),
    q(`insert into ops.bed_reservations (unit_id, patient_id, reserved_for, expected_on, status, closed_at) values ('unit-B1', '${KID}', 'Held Bed', ${TODAY}, 'used', now())`), denied);
  await scenario(ids, "social workers release a hold", "social_worker", withHold,
    q("update ops.bed_reservations set status = 'released', closed_at = now() where patient_id = $1 and status = 'active'", [KID]), rows(1));
  await scenario(ids, "a closed hold carries when it closed", "social_worker", withHold,
    q("update ops.bed_reservations set status = 'released' where patient_id = $1", [KID]), checkFailed);
  await scenario(ids, "house staff cannot release", "house_staff", withHold,
    q("update ops.bed_reservations set status = 'released', closed_at = now() where patient_id = $1", [KID]), rows(0));
  await scenario(ids, "nobody deletes a hold (release it)", "admin", withHold, q("delete from ops.bed_reservations where patient_id = $1", [KID]), denied);
  await scenario(ids, "a released child can be held again", "social_worker", withSeed(() => hold("released")), q(reserveSql), value("mine", true));

  // ---- group orientation ----
  const talk = `insert into ops.group_orientations (trip_id) values ('${TRIP}') returning held_by = auth.uid() as mine`;
  await scenario(ids, "social workers record a group's house rules talk", "social_worker", withSeed(), q(talk), value("mine", true));
  await scenario(ids, "once per trip", "social_worker", withSeed(() => client.query(`insert into ops.group_orientations (trip_id) values ('${TRIP}')`)), q(talk), duplicate);
  await scenario(ids, "a talk belongs to exactly one trip or ride", "admin", withSeed(), asOwner("insert into ops.group_orientations (trip_id, ride_id) values (null, null)"), checkFailed);
  await scenario(ids, "house staff cannot record it", "house_staff", withSeed(), q(talk), denied);
  await scenario(ids, "drivers do not read it (Patients only)", "driver",
    withSeed(() => client.query(`insert into ops.group_orientations (trip_id) values ('${TRIP}')`)),
    q("select id from ops.group_orientations where trip_id = $1", [TRIP]), rows(0));

  // ---- 0066: confirmation or replacement ----
  const replaceSql = `select ops.replace_bed_reservation((select id from ops.bed_reservations where patient_id = '${KID}' and status = 'active'), '${KID2}', null, 'Other Kid') as id`;
  await scenario(ids, "a social worker gives a reserved bed to another child", "social_worker", withHold,
    last({ sql: replaceSql },
      { sql: `select o.status = 'replaced' and o.replaced_by = n.id and n.status = 'active' and n.unit_id = o.unit_id and n.created_by = auth.uid() as ok
              from ops.bed_reservations o join ops.bed_reservations n on n.id = o.replaced_by where o.patient_id = $1`, params: [KID] }),
    value("ok", true));
  await scenario(ids, "house staff cannot replace", "house_staff", withHold, q(replaceSql), (r) => !r.ok);
  await scenario(ids, "a closed hold cannot be replaced", "social_worker", withSeed(() => hold("released")),
    q(`select ops.replace_bed_reservation((select id from ops.bed_reservations where patient_id = '${KID}'), '${KID2}', null, 'Other Kid')`), (r) => !r.ok && r.code === "P0002");
  await scenario(ids, "replaced always names who took the bed", "admin", withHold,
    asOwner(`update ops.bed_reservations set status = 'replaced', closed_at = now() where patient_id = '${KID}'`), checkFailed);
  await scenario(ids, "drivers cannot replace", "driver", withHold, q(replaceSql), (r) => !r.ok);

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
