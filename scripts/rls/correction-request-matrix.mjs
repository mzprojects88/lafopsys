// Proves 0061/0062 (DTR correction requests: report, approve, reject) against
// the live database, one scenario per transaction, every one rolled back.
// Same harness as scripts/rls/floor-plan-policy-matrix.mjs.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/correction-request-matrix.mjs
// Pre-flight: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/correction-request-matrix.mjs supabase/migrations/0062_decide_correction_requests.sql
import { readFile } from "node:fs/promises";

import { Client } from "pg";
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

const ROLES = ["admin", "social_worker", "driver", "finance"];
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
const MINE = "00000000-0000-4000-8000-00000000e0a1";
const THEIRS = "00000000-0000-4000-8000-00000000e0a2";
const CLOSED = "00000000-0000-4000-8000-00000000e0a3";
// Two forgotten days (clocked in 50 hours ago, never out) and one closed day.
const seedFor = (ids) => async () => {
  const days = [[MINE, ids.social_worker, 5, null], [THEIRS, ids.driver, 5, null], [CLOSED, ids.social_worker, 6, "17:00"]];
  for (const [id, who, back, out] of days) {
    await client.query(
      `insert into ops.time_entries (id, staff_id, date, clock_in, clock_out) values ($1, $2, (now() at time zone 'Asia/Manila')::date - $3::int, '08:00', $4)`,
      [id, who, back, out]
    );
    await client.query(`insert into ops.time_punches (time_entry_id, staff_id, punch_type, punched_at, source) values ($1, $2, 'clock_in', now() - interval '50 hours', 'device')`, [id, who]);
  }
};
const report = (entry, leftAt) => `select ops.report_missed_clock_out('${entry}', ${leftAt}, 'Forgot to clock out.') as id`;
const EIGHT_HOURS_IN = "now() - interval '42 hours'";

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
  const seeded = { setup: seedFor(ids) };
  const reported = { setup: async () => { await seedFor(ids)(); await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims(ids.social_worker)]); await client.query(report(MINE, EIGHT_HOURS_IN)); } };

  await scenario(ids, "staff report their own forgotten clock-out", "social_worker", seeded,
    last({ sql: report(MINE, EIGHT_HOURS_IN) },
      { sql: `select (select flag from ops.time_entries where id = '${MINE}') = 'missed_punch' and (select status from ops.dtr_correction_requests where time_entry_id = '${MINE}') = 'pending' as ok` }),
    value("ok", true));
  await scenario(ids, "nobody reports someone else's day", "social_worker", seeded, q(report(THEIRS, EIGHT_HOURS_IN)), denied);
  await scenario(ids, "a time before the clock-in is refused", "social_worker", seeded, q(report(MINE, "now() - interval '60 hours'")), (r) => !r.ok && r.code === "22023");
  await scenario(ids, "a time in the future is refused", "social_worker", seeded, q(report(MINE, "now() + interval '1 hour'")), (r) => !r.ok && r.code === "22023");
  await scenario(ids, "a time past 25 hours is refused", "social_worker", seeded, q(report(MINE, "now() - interval '20 hours'")), (r) => !r.ok && r.code === "22023");
  await scenario(ids, "a day with a clock-out cannot be reported", "social_worker", seeded, q(report(CLOSED, EIGHT_HOURS_IN)), (r) => !r.ok && r.code === "22023");
  await scenario(ids, "one open request per day", "social_worker", reported, q(report(MINE, EIGHT_HOURS_IN)), (r) => !r.ok && (r.code === "23505" || r.code === "22023"));
  await scenario(ids, "staff read their own requests", "social_worker", reported, q(`select id from ops.dtr_correction_requests where time_entry_id = '${MINE}'`), rows(1));
  await scenario(ids, "staff do not read others' requests", "driver", reported, q("select id from ops.dtr_correction_requests"), rows(0));
  await scenario(ids, "admins read every request", "admin", reported, q(`select id from ops.dtr_correction_requests where time_entry_id = '${MINE}'`), rows(1));
  await scenario(ids, "nobody writes a request directly", "social_worker", seeded,
    q(`insert into ops.dtr_correction_requests (staff_id, time_entry_id, kind, punch_type, requested_at, reason) values ('${ids.social_worker}', '${MINE}', 'missed_clock_out', 'clock_out', now(), 'x y z')`), denied);
  await scenario(ids, "nobody approves their own request directly", "social_worker", reported,
    q(`update ops.dtr_correction_requests set status = 'approved' where time_entry_id = '${MINE}'`), denied);


  // ---- 0062: deciding ----
  const reqId = `(select id from ops.dtr_correction_requests where time_entry_id = '${MINE}')`;
  const asHr = (who) => ({ setup: async () => { await reported.setup(); await client.query("update shared.staff set is_hr = true where id = $1", [ids[who]]); } });
  await scenario(ids, "an admin approves: a signed clock-out at the stated time", "admin", reported,
    last({ sql: `select ops.approve_correction_request(${reqId}, null)` },
      { sql: `select r.status = 'approved' and p.source = 'adjustment' and p.adjusted_by = '${ids.admin}' and p.punched_at = r.requested_at and p.punch_type = 'clock_out' as ok
              from ops.dtr_correction_requests r join ops.time_punches p on p.id = r.adjustment_punch_id where r.time_entry_id = '${MINE}'` }),
    value("ok", true));
  await scenario(ids, "HR (not admin) approves", "driver", asHr("driver"), q(`select ops.approve_correction_request(${reqId}, null)`), rows(1));
  await scenario(ids, "other staff cannot approve", "driver", reported, q(`select ops.approve_correction_request(${reqId}, null)`), denied);
  await scenario(ids, "nobody decides their own request", "social_worker", asHr("social_worker"), q(`select ops.approve_correction_request(${reqId}, null)`), denied);
  await scenario(ids, "a rejection needs a reason", "admin", reported, q(`select ops.reject_correction_request(${reqId}, '')`), (r) => !r.ok && r.code === "22023");
  await scenario(ids, "after a rejection the person can ask again", "social_worker",
    { setup: async () => { await reported.setup(); await client.query("update shared.staff set active = true, role = 'admin' where id = $1", [ids.admin]); await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims(ids.admin)]); await client.query(`select ops.reject_correction_request(${reqId}, 'Time is wrong')`); await client.query("update ops.time_entries set flag = 'on_time' where id = $1", [MINE]); } },
    q(report(MINE, EIGHT_HOURS_IN)), rows(1));
  await scenario(ids, "a request is decided once", "admin",
    { setup: async () => { await reported.setup(); await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims(ids.admin)]); await client.query(`select ops.approve_correction_request(${reqId}, null)`); } },
    q(`select ops.reject_correction_request(${reqId}, 'Changed my mind')`), (r) => !r.ok && r.code === "22023");
  await scenario(ids, "not approved over a day that already has a clock-out", "admin",
    { setup: async () => { await reported.setup(); await client.query("update ops.time_entries set clock_out = '17:00' where id = $1", [MINE]); } },
    q(`select ops.approve_correction_request(${reqId}, null)`), (r) => !r.ok && r.code === "22023");

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
