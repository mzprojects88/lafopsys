// The 0141 pre-flight (the Super Admin deletes a punch made by mistake), on the development database and ALWAYS
// rolled back: applies the migration in a transaction, makes test punches there, and proves who may delete, that a
// reason is required, that the deletion is logged and that an emptied day goes with it.
//   node --env-file=.env.local scripts/rls/punch-delete-matrix.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";

if (isProd() || !pgUrl().includes("kptftyuzrnummbcjakro")) throw new Error("dev only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
let pass = 0, fail = 0;
async function step(name, who, sql, params, expect, keep = true) {
  await c.query("savepoint s");
  let r;
  try {
    if (who) {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: "authenticated" })]);
      await c.query("set local role authenticated");
      await c.query("discard plans");
    }
    const q = await c.query(sql, params);
    r = { ok: true, rows: q.rows, n: q.rowCount };
  } catch (e) {
    r = { ok: false, error: e.message, code: e.code };
  }
  if (!r.ok || !keep) await c.query("rollback to savepoint s");
  await c.query("reset role");
  if (r.ok && keep) await c.query("release savepoint s");
  const good = expect(r);
  good ? pass++ : fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name}  ${r.ok ? `rows=${r.n} ${JSON.stringify(r.rows?.[0] ?? "").slice(0, 110)}` : `${r.code} ${r.error.slice(0, 120)}`}`);
  return r;
}
const refused = (code) => (r) => !r.ok && (!code || r.code === code);
const one = async (sql, params = []) => Object.values((await c.query(sql, params)).rows[0])[0];

try {
  await c.query("begin");
  await c.query(readFileSync(new URL("../../supabase/migrations/0141_delete_mistaken_punch.sql", import.meta.url), "utf8"));
  const ids = (await c.query(`select
    (select id from shared.staff where active and role = 'admin' order by id limit 1) admin,
    (select id from shared.staff s where active and role <> 'admin' and not ('admin' = any(extra_roles)) and is_hr limit 1) hr,
    (select id from shared.staff where active and role = 'finance' and not ('admin' = any(extra_roles)) limit 1) finance,
    (select id from shared.staff where active and role = 'driver' and extra_roles = '{}' limit 1) driver`)).rows[0];
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);

  // Test punches far in the future (no real day collides): day A has one clock-in; day B a clock-in and a clock-out.
  const entry = async (day) => one(`insert into ops.time_entries (staff_id, date, clock_in, flag) values ($1, $2, '06:01', 'on_time') returning id`, [ids.driver, day]);
  const punch = async (e, type, at) =>
    one(`insert into ops.time_punches (time_entry_id, staff_id, punch_type, punched_at, location_status, source) values ($1, $2, $3, $4, 'captured', 'device') returning id`, [e, ids.driver, type, at]);
  const eA = await entry("2099-01-05");
  const pA = await punch(eA, "clock_in", "2099-01-04T22:01:00Z");
  await c.query(`insert into ops.time_punch_photos (punch_id, staff_id, object_key, bytes) values ($1, $2, 'test/punch-a.jpg', 100)`, [pA, ids.driver]);
  const eB = await entry("2099-01-06");
  const pB1 = await punch(eB, "clock_in", "2099-01-06T00:00:00Z");
  await punch(eB, "clock_out", "2099-01-06T08:00:00Z");

  await step("the driver can't delete their own punch", ids.driver, `select ops.time_punch_delete($1, 'mistake')`, [pA], refused("42501"), false);
  await step("HR can't delete a punch", ids.hr, `select ops.time_punch_delete($1, 'mistake')`, [pA], refused("42501"), false);
  await step("Finance can't either", ids.finance, `select ops.time_punch_delete($1, 'mistake')`, [pA], refused("42501"), false);
  await step("nobody writes the log directly", ids.admin, `insert into ops.time_punch_deletions (punch_id, punched_at, punch, reason) values (gen_random_uuid(), now(), '{}', 'x')`, [], refused("42501"), false);
  await step("the Super Admin needs a reason", ids.admin, `select ops.time_punch_delete($1, ' ')`, [pA], refused("23514"), false);
  await step("the Super Admin deletes the mistaken punch", ids.admin, `select ops.time_punch_delete($1, 'Punched in by mistake') r`, [pA],
    (r) => r.ok && r.rows[0].r.entry_deleted === true && r.rows[0].r.photo_key === "test/punch-a.jpg");
  await step("... the punch, its photo record and its emptied day are gone", null,
    `select (select count(*)::int from ops.time_punches where id = $1) + (select count(*)::int from ops.time_punch_photos where punch_id = $1) + (select count(*)::int from ops.time_entries where id = $2) n`, [pA, eA],
    (r) => r.ok && r.rows[0].n === 0);
  await step("... and the log keeps a full copy with who and why", null,
    `select reason, deleted_by = $2 who, punch->>'punch_type' t, photo_key from ops.time_punch_deletions where punch_id = $1`, [pA, ids.admin],
    (r) => r.ok && r.rows[0].who === true && r.rows[0].t === "clock_in" && r.rows[0].photo_key === "test/punch-a.jpg");
  await step("HR reads the log", ids.hr, `select count(*)::int n from ops.time_punch_deletions where punch_id = $1`, [pA], (r) => r.ok && r.rows[0].n === 1);
  await step("the driver doesn't", ids.driver, `select count(*)::int n from ops.time_punch_deletions`, [], (r) => r.ok && r.rows[0].n === 0);
  await step("a day with another punch stays (the route recomputes it)", ids.admin, `select ops.time_punch_delete($1, 'Duplicate punch') r`, [pB1],
    (r) => r.ok && r.rows[0].r.entry_deleted === false);
  await step("... its other punch is still there", null, `select count(*)::int n from ops.time_punches where time_entry_id = $1`, [eB], (r) => r.ok && r.rows[0].n === 1);
  const eC = await entry("2099-01-07");
  const pC = await punch(eC, "clock_in", "2099-01-07T00:00:00Z");
  await c.query(`insert into ops.dtr_correction_requests (time_entry_id, staff_id, kind, punch_type, requested_at, reason) values ($1, $2, 'missed_clock_out', 'clock_out', '2099-01-07T09:00:00Z', 'forgot')`, [eC, ids.driver]);
  await step("a day with a correction request is settled through the request", ids.admin, `select ops.time_punch_delete($1, 'mistake')`, [pC], refused("23514"), false);
  await step("an unknown punch", ids.admin, `select ops.time_punch_delete(gen_random_uuid(), 'mistake')`, [], refused("P0002"), false);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
