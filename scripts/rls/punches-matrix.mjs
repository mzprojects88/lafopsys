// The 0146 pre-flight (Staff & Time › Punches), on the development database and ALWAYS rolled back: applies the
// migration in a transaction, makes test punches in 2099 and proves who manages punches (the power, HR), who reads
// what, and that adding, changing, deleting and deciding keep their rules and their log.
//   node --env-file=.env.local scripts/rls/punches-matrix.mjs
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
  if (good) pass++;
  else fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name}  ${r.ok ? `rows=${r.n} ${JSON.stringify(r.rows?.[0] ?? "").slice(0, 110)}` : `${r.code} ${r.error.slice(0, 120)}`}`);
  return r;
}
const refused = (code) => (r) => !r.ok && (!code || r.code === code);
const one = async (sql, params = []) => Object.values((await c.query(sql, params)).rows[0])[0];
const n = (want) => (r) => r.ok && r.rows[0].n === want;

try {
  await c.query("begin");
  await c.query(readFileSync(new URL("../../supabase/migrations/0146_punches_page.sql", import.meta.url), "utf8"));
  const ids = (await c.query(`select
    (select id from shared.staff where active and role = 'finance' and not ('admin' = any(extra_roles)) limit 1) finance,
    (select id from shared.staff where active and role = 'social_worker' and extra_roles = '{}' and not is_hr limit 1) sw,
    (select id from shared.staff where active and role = 'driver' and extra_roles = '{}' and not is_hr limit 1) driver`)).rows[0];
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);
  // Finance without the HR switch, so the power alone is what lets them.
  await c.query(`update shared.staff set is_hr = false where id = $1`, [ids.finance]);

  await step("the power is given to Office Admin, the CEO and Finance", null,
    `select count(*)::int n from shared.role_powers where power = 'manage_punches' and role in ('office_admin', 'ceo', 'finance')`, [], n(3));
  await step("the page is on for the CEO and every role with the DTR", null,
    `select count(*)::int n from shared.role_page_access where page = 'staff.punches' and role in ('ceo', 'driver', 'social_worker', 'finance')`, [], n(4));

  // The driver's test day: a clock-in at 8:00 AM Manila, 1 Feb 2099.
  const eA = await one(`insert into ops.time_entries (staff_id, date, clock_in) values ($1, '2099-02-01', '08:00') returning id`, [ids.driver]);
  const pIn = await one(`insert into ops.time_punches (time_entry_id, staff_id, punch_type, punched_at, location_status, source) values ($1, $2, 'clock_in', '2099-02-01T00:00:00Z', 'captured', 'device') returning id`, [eA, ids.driver]);

  const add = (actor, staff, type, at, entry, reason = "Forgot to punch") => ["select ops.time_punch_add($1, $2, $3, $4, $5, $6) r", [staff, type, at, entry, reason, actor]];
  const edit = (actor, punch, at, reason = "Wrong time") => ["select ops.time_punch_edit($1, $2, $3, $4) r", [punch, at, reason, actor]];
  await step("nobody calls add from the browser", ids.finance, `select ops.time_punch_add($1, 'clock_out', now(), $2, 'x y z', $3)`, [ids.driver, eA, ids.finance], refused("42501"), false);
  await step("a punch in the future is refused (real clock)", null, ...add(ids.finance, ids.driver, "clock_out", "2099-02-01T09:00:00Z", eA), (r) => !r.ok && /future/.test(r.error), false);
  // Times in 2099 are in the future, so from here the two functions (redefined inside this rolled-back transaction)
  // read the clock as 1 March 2099.
  for (const fn of ["time_punch_add(uuid, text, timestamptz, uuid, text, uuid)", "time_punch_edit(uuid, timestamptz, text, uuid)"]) {
    const def = await one(`select pg_get_functiondef('ops.${fn}'::regprocedure)`);
    await c.query(def.replace(/now\(\)/g, "'2099-03-01'::timestamptz"));
  }

  await step("the driver can't add a punch", null, ...add(ids.driver, ids.driver, "clock_out", "2099-02-01T09:00:00Z", eA), refused("42501"), false);
  await step("the social worker can't either", null, ...add(ids.sw, ids.driver, "clock_out", "2099-02-01T09:00:00Z", eA), refused("42501"), false);
  await step("a reason of 3 characters or more", null, ...add(ids.finance, ids.driver, "clock_out", "2099-02-01T09:00:00Z", eA, "no"), refused("23514"), false);
  await step("a clock-out goes on its day or the morning after", null, ...add(ids.finance, ids.driver, "clock_out", "2099-02-03T01:00:00Z", eA), refused("23514"), false);
  const req = await one(`insert into ops.dtr_correction_requests (time_entry_id, staff_id, kind, punch_type, requested_at, reason) values ($1, $2, 'missed_clock_out', 'clock_out', '2099-02-01T09:30:00Z', 'forgot') returning id`, [eA, ids.driver]);
  await step("not over a request still to decide", null, ...add(ids.finance, ids.driver, "clock_out", "2099-02-01T09:00:00Z", eA), (r) => !r.ok && /request waiting/.test(r.error), false);

  await step("Finance (the power, no HR switch) reads the driver's request", ids.finance, `select count(*)::int n from ops.dtr_correction_requests where id = $1`, [req], n(1));
  await step("the social worker doesn't", ids.sw, `select count(*)::int n from ops.dtr_correction_requests where id = $1`, [req], n(0));
  await step("the social worker can't decide it", ids.sw, `select ops.reject_correction_request($1, 'not right')`, [req], refused("42501"), false);
  await step("the driver can't decide their own", ids.driver, `select ops.approve_correction_request($1)`, [req], refused("42501"), false);
  await step("Finance approves it: the OUT is on the record", ids.finance, `select ops.approve_correction_request($1) r`, [req], (r) => r.ok && !!r.rows[0].r);
  const pOut = await one(`select adjustment_punch_id from ops.dtr_correction_requests where id = $1`, [req]);

  await step("Finance reads all of the driver's punches", ids.finance, `select count(*)::int n from ops.time_punches where time_entry_id = $1`, [eA], n(2));
  await step("the social worker reads none of them", ids.sw, `select count(*)::int n from ops.time_punches where time_entry_id = $1`, [eA], n(0));
  await step("nobody changes a punch directly", ids.finance, `update ops.time_punches set punched_at = punched_at where id = $1`, [pIn], (r) => r.ok && r.n === 0, false);

  await step("the driver can't change a time", null, ...edit(ids.driver, pIn, "2099-02-01T00:10:00Z"), refused("42501"), false);
  await step("a clock-in stays on its day", null, ...edit(ids.finance, pIn, "2099-02-02T00:10:00Z"), refused("23514"), false);
  await step("not the time it has already", null, ...edit(ids.finance, pIn, "2099-02-01T00:00:00Z"), refused("23514"), false);
  await step("Finance changes the IN to 8:10 AM", null, ...edit(ids.finance, pIn, "2099-02-01T00:10:00Z"), (r) => r.ok && r.rows[0].r.time_entry_id === eA);
  await step("... the punch has the new time", null, `select count(*)::int n from ops.time_punches where id = $1 and punched_at = '2099-02-01T00:10:00Z'`, [pIn], n(1));
  await step("... and the log the original, with who and why", null,
    `select count(*)::int n from ops.time_punch_deletions where punch_id = $1 and action = 'edited' and punched_at = '2099-02-01T00:00:00Z' and new_punched_at = '2099-02-01T00:10:00Z' and deleted_by = $2 and reason = 'Wrong time'`, [pIn, ids.finance], n(1));
  await step("the OUT may move to the morning after", null, ...edit(ids.finance, pOut, "2099-02-01T17:00:00Z"), (r) => r.ok);
  await step("the driver reads the changes to their own punches", ids.driver, `select count(*)::int n from ops.time_punch_deletions where staff_id = $1`, [ids.driver], n(2));
  await step("the social worker doesn't", ids.sw, `select count(*)::int n from ops.time_punch_deletions where staff_id = $1`, [ids.driver], n(0));

  await step("Finance adds a clock-in on a day with none: the day is made, marked missed_punch", null, ...add(ids.finance, ids.driver, "clock_in", "2099-02-05T00:00:00Z", null), (r) => r.ok && r.rows[0].r.day === "2099-02-05");
  await step("... signed and marked Added", null,
    `select count(*)::int n from ops.time_punches p join ops.time_entries e on e.id = p.time_entry_id where e.staff_id = $1 and e.date = '2099-02-05' and e.flag = 'missed_punch' and p.source = 'adjustment' and p.adjusted_by = $2`, [ids.driver, ids.finance], n(1));
  const eB = await one(`select id from ops.time_entries where staff_id = $1 and date = '2099-02-05'`, [ids.driver]);
  await step("... and its OUT", null, ...add(ids.finance, ids.driver, "clock_out", "2099-02-05T09:00:00Z", eB), (r) => r.ok && r.rows[0].r.time_entry_id === eB);
  await step("a clock-out on another person's day is refused", null, ...add(ids.finance, ids.sw, "clock_out", "2099-02-05T09:00:00Z", eB), refused("P0002"), false);

  const pOutB = await one(`select id from ops.time_punches where time_entry_id = $1 and punch_type = 'clock_out'`, [eB]);
  await step("the social worker can't delete a punch", null, `select ops.time_punch_delete($1, 'mistake', $2)`, [pOutB, ids.sw], refused("42501"), false);
  await step("an OUT an approved request made is settled through the request", null, `select ops.time_punch_delete($1, 'mistake', $2)`, [pOut, ids.finance], refused("23514"), false);
  await step("Finance deletes one (logged as deleted)", null, `select ops.time_punch_delete($1, 'Made by mistake', $2) r`, [pOutB, ids.finance], (r) => r.ok);
  await step("... the log says deleted", null, `select count(*)::int n from ops.time_punch_deletions where punch_id = $1 and action = 'deleted'`, [pOutB], n(1));
} finally {
  await c.query("rollback");
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
