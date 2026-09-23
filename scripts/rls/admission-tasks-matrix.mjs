// Proves 0054 (the admission tasks belong to the stay: per-stay orientation
// ticks, the returnee flag on a topic) against the live database, one
// scenario per transaction, every transaction rolled back. Same harness as
// scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1 acknowledges
// that lafopsys has one database.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/admission-tasks-matrix.mjs
// Pre-flight (before 0049-0054 are applied, one rolled-back transaction):
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/admission-tasks-matrix.mjs supabase/migrations/0049_check_in.sql supabase/migrations/0050_module_access.sql supabase/migrations/0051_sheet_admission.sql supabase/migrations/0052_arrival_rides.sql supabase/migrations/0053_laf_hope_pickups.sql supabase/migrations/0054_stay_admission_tasks.sql
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

// Fixtures: a patient with a stay, and two orientation topics (one of them
// also covered with returning families).
const P1 = "00000000-0000-4000-8000-0000000000f1";
const STAY = "00000000-0000-4000-8000-0000000000f2";
const T_ALL = "00000000-0000-4000-8000-0000000000f3";
const T_FIRST = "00000000-0000-4000-8000-0000000000f4";
const seed = async () => {
  await client.query(
    `insert into ops.patients (id, patient_number, first_name, last_name, sex, status, admitted_at)
     values ($1, 'RLSTEST-AD1', 'Tasks', 'Family', 'F', 'ongoing', current_date)`,
    [P1]
  );
  await client.query(
    `insert into ops.stays (id, patient_id, bed_position_id, check_in_at, status) values ($1, $2, 'unit-B1-A', current_date, 'in_house')`,
    [STAY, P1]
  );
  await client.query(
    `insert into ops.orientation_topics (id, topic, sort_order, returnee_too) values ($1, 'House rules', 1, true), ($2, 'The full tour', 2, false)`,
    [T_ALL, T_FIRST]
  );
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
const tick = `insert into ops.stay_orientation_checks (stay_id, topic_id) values ('${STAY}', '${T_ALL}') returning covered_by_staff_id`;

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

  await scenario(ids, "a social worker ticks a topic for this stay and is stamped", "social_worker", withSeed(),
    q(tick), (r) => value("covered_by_staff_id", ids.social_worker)(r));
  await scenario(ids, "the stamp cannot be written by hand", "social_worker", withSeed(),
    q(`insert into ops.stay_orientation_checks (stay_id, topic_id, covered_by_staff_id) values ('${STAY}', '${T_ALL}', '${ids.admin}') returning covered_by_staff_id`),
    (r) => value("covered_by_staff_id", ids.social_worker)(r));
  await scenario(ids, "unticking removes it", "social_worker",
    withSeed(() => client.query(`insert into ops.stay_orientation_checks (stay_id, topic_id) values ($1, $2)`, [STAY, T_ALL])),
    q(`delete from ops.stay_orientation_checks where stay_id = '${STAY}' and topic_id = '${T_ALL}'`), rows(1));
  await scenario(ids, "a view-only social worker cannot tick", "social_worker",
    withSeed(() => setLevel("social_worker", "patients", "view")), q(tick), denied);
  await scenario(ids, "a driver cannot tick", "driver", withSeed(), q(tick), denied);
  await scenario(ids, "a driver reads no ticks", "driver",
    withSeed(() => client.query(`insert into ops.stay_orientation_checks (stay_id, topic_id) values ($1, $2)`, [STAY, T_ALL])),
    q(`select topic_id from ops.stay_orientation_checks where stay_id = '${STAY}'`), rows(0));
  await scenario(ids, "the ticks follow the stay, not the patient", "social_worker", withSeed(),
    last({ sql: tick },
      { sql: `select count(*)::int as n from ops.stay_orientation_checks c join ops.stays s on s.id = c.stay_id where s.patient_id = $1`, params: [P1] }),
    value("n", 1));
  await scenario(ids, "a discharged stay keeps its ticks", "social_worker",
    withSeed(async () => {
      await client.query(`insert into ops.stay_orientation_checks (stay_id, topic_id) values ($1, $2)`, [STAY, T_ALL]);
      await client.query(`update ops.stays set status = 'checked_out', check_out_at = current_date, check_out_reason = 'completed_treatment' where id = $1`, [STAY]);
    }), q(`select topic_id from ops.stay_orientation_checks where stay_id = '${STAY}'`), rows(1));
  await scenario(ids, "a social worker marks a topic for returnees too", "social_worker", withSeed(),
    q(`update ops.orientation_topics set returnee_too = true where id = '${T_FIRST}' returning returnee_too`), value("returnee_too", true));
  await scenario(ids, "a driver cannot change the topic list", "driver", withSeed(),
    q(`update ops.orientation_topics set topic = 'Nope' where id = '${T_ALL}'`), rows(0));
  await scenario(ids, "the house's own Mga Paalala are the starting list", "social_worker", null,
    q("select count(*)::int as n from ops.orientation_topics where topic like '6:00 AM ang oras%' or topic like 'Magdasal muna%'"), value("n", 2));
  await scenario(ids, "the old per-patient checklist is gone", "admin", withSeed(),
    q("select 1 from ops.patient_orientation_checks"), (r) => !r.ok && r.code === "42P01");

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
