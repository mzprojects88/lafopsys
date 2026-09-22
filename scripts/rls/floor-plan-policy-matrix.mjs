// Proves the floor-plan rules of 0047 (ops.units / ops.rooms guard triggers,
// column grants, ops.create_bed / ops.retire_bed) and 0048 (ops.floor_plan_labels:
// everyone reads, only admins write) against the live database,
// one scenario per transaction, every transaction rolled back -- nothing
// persists. lafopsys has a single database, so this runs against production
// by design; RLS_ALLOW_PROD=1 acknowledges that.
//
// Same harness as scripts/rls/hr-policy-matrix.mjs: fixtures are inserted as
// postgres, then the connection switches to `set local role authenticated`
// with request.jwt.claims set to a real staff member's id -- what PostgREST
// does for a signed-in session -- and runs one statement.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/floor-plan-policy-matrix.mjs
//
// Pre-flight: pass the migration file to prove it BEFORE it is applied. The
// whole run then happens in one transaction -- the file first, then every
// scenario under a savepoint -- and is rolled back at the end:
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/floor-plan-policy-matrix.mjs supabase/migrations/0047_floor_plan_beds.sql
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

// Fixture: one patient checked into B1 (position A). Inserted only by the
// scenarios that need an occupied bed.
const PATIENT = "00000000-0000-4000-8000-0000000000b1";
const STAY = "00000000-0000-4000-8000-0000000000b2";
const occupyB1 = async () => {
  await client.query(
    `insert into ops.patients (id, patient_number, first_name, last_name, sex, status, admitted_at)
     values ($1, 'RLSTEST-B1', 'Test', 'Bed', 'M', 'ongoing', current_date)`,
    [PATIENT]
  );
  await client.query(
    `insert into ops.stays (id, patient_id, bed_position_id, check_in_at, status)
     values ($1, $2, 'unit-B1-A', current_date, 'in_house')`,
    [STAY, PATIENT]
  );
};

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

  const move = "update ops.units set x = 0.5, y = 0.5, rotation_deg = 90, room_id = 'room-1' where id = 'unit-B1'";
  const lock = "update ops.units set status = 'maintenance', lock_reason = 'Broken slat' where id = 'unit-B1' returning status_changed_by";

  // --- reading ----------------------------------------------------------------
  await scenario(ids, "driver reads the beds and rooms", "driver", null, q("select u.id from ops.units u join ops.rooms r on true where u.code = 'B1'"), atLeast(1));
  await scenario(ids, "driver reads the positions", "driver", null, q("select id from ops.bed_positions where unit_id = 'unit-B1'"), rows(4));

  // --- the drawing is the admin's ------------------------------------------------
  await scenario(ids, "admin places and rotates a bed", "admin", null, q(move), rows(1));
  await scenario(ids, "social worker cannot move a bed", "social_worker", null, q(move), denied);
  // Since 0050 house staff and drivers have no Patients edit: RLS filters the row out.
  await scenario(ids, "house staff cannot move a bed", "house_staff", null, q(move), rows(0));
  await scenario(ids, "driver cannot move a bed", "driver", null, q(move), rows(0));
  // RLS hides every row from a session without a staff role: 0 rows, no error.
  await scenario(ids, "no session cannot move a bed", null, null, q(move), rows(0));
  await scenario(ids, "admin cannot place x without y", "admin", null, q("update ops.units set x = 0.5, y = null where id = 'unit-B1'"), checkFailed);
  await scenario(ids, "admin cannot place a bed off the plan", "admin", null, q("update ops.units set x = 1.5, y = 0.5 where id = 'unit-B1'"), checkFailed);
  await scenario(ids, "admin changes capacity", "admin", null, q("update ops.units set capacity = 2 where id = 'unit-B1'"), rows(1));
  await scenario(ids, "social worker cannot change capacity", "social_worker", null, q("update ops.units set capacity = 2 where id = 'unit-B1'"), denied);
  await scenario(ids, "admin cannot insert a unit directly", "admin", null, q("insert into ops.units (id, code, status) values ('unit-B98', 'B98', 'available')"), denied);
  await scenario(ids, "admin cannot delete a unit", "admin", null, q("delete from ops.units where id = 'unit-B13'"), denied);
  await scenario(ids, "admin cannot insert a position directly", "admin", null, q("insert into ops.bed_positions (id, unit_id, label) values ('unit-B1-E', 'unit-B1', 'A')"), denied);

  // --- the lock is wider ---------------------------------------------------------
  await scenario(ids, "admin locks a bed and the stamp is theirs", "admin", null, q(lock), (r) => value("status_changed_by", ids.admin)(r));
  await scenario(ids, "social worker locks a bed and the stamp is theirs", "social_worker", null, q(lock), (r) => value("status_changed_by", ids.social_worker)(r));
  await scenario(ids, "house staff cannot lock a bed (0050)", "house_staff", null, q(lock), rows(0));
  await scenario(ids, "driver cannot lock a bed", "driver", null, q(lock), rows(0));
  await scenario(ids, "a lock needs a reason", "admin", null, q("update ops.units set status = 'blocked' where id = 'unit-B1'"), checkFailed);
  await scenario(ids, "a blank reason is no reason", "admin", null, q("update ops.units set status = 'blocked', lock_reason = '   ' where id = 'unit-B1'"), checkFailed);
  await scenario(ids, "'occupied' can no longer be stored", "admin", null, q("update ops.units set status = 'occupied' where id = 'unit-B1'"), checkFailed);
  await scenario(
    ids,
    "unlocking clears the reason",
    "social_worker",
    { setup: () => client.query("update ops.units set status = 'maintenance', lock_reason = 'Broken slat' where id = 'unit-B1'") },
    q("update ops.units set status = 'available' where id = 'unit-B1' returning lock_reason"),
    value("lock_reason", null)
  );
  await scenario(ids, "the lock stamp cannot be written by hand", "admin", null, q("update ops.units set status_changed_at = now() where id = 'unit-B1'"), denied);
  await scenario(ids, "locking an occupied bed is allowed", "social_worker", { setup: occupyB1 }, q(lock), rows(1));

  // --- create / retire -------------------------------------------------------------
  const create = "select ops.create_bed('B99', 'room-2', 0.6, 0.6, 90) as id";
  await scenario(ids, "social worker cannot add a bed", "social_worker", null, q(create), denied);
  await scenario(ids, "house staff cannot add a bed", "house_staff", null, q(create), denied);
  await scenario(
    ids,
    "admin adds a bed and gets its four positions",
    "admin",
    null,
    last({ sql: create }, { sql: "select count(*)::int as n from ops.bed_positions where unit_id = 'unit-B99'" }),
    value("n", 4)
  );
  await scenario(ids, "a live code cannot be added twice", "admin", null, q("select ops.create_bed('B1', null, null, null, 0)"), duplicate);
  await scenario(ids, "a bed code must look like B14", "admin", null, q("select ops.create_bed('Bed 14', null, null, null, 0)"), checkFailed);
  await scenario(ids, "an unknown room is refused", "admin", null, q("select ops.create_bed('B99', 'room-9', null, null, 0)"), (r) => !r.ok && r.code === "23503");
  await scenario(
    ids,
    "admin retires a free bed",
    "admin",
    null,
    last({ sql: "select ops.retire_bed('unit-B13')" }, { sql: "select active, retired_at is not null as stamped from ops.units where id = 'unit-B13'" }),
    (r) => r.ok && r.data[0].active === false && r.data[0].stamped === true
  );
  await scenario(ids, "social worker cannot retire a bed", "social_worker", null, q("select ops.retire_bed('unit-B13')"), denied);
  await scenario(ids, "an occupied bed cannot be retired", "admin", { setup: occupyB1 }, q("select ops.retire_bed('unit-B1')"), checkFailed);
  await scenario(ids, "an occupied bed cannot be deactivated by hand either", "admin", { setup: occupyB1 }, q("update ops.units set active = false where id = 'unit-B1'"), checkFailed);
  await scenario(
    ids,
    "adding a retired code brings the bed back in place",
    "admin",
    { setup: () => client.query("update ops.units set active = false, retired_at = now() where id = 'unit-B13'") },
    last({ sql: "select ops.create_bed('B13', 'room-3', 0.4, 0.4, 0)" }, { sql: "select active, x::float as x, room_id from ops.units where id = 'unit-B13'" }),
    (r) => r.ok && r.data[0].active === true && r.data[0].x === 0.4 && r.data[0].room_id === "room-3"
  );

  // --- rooms -------------------------------------------------------------------------
  const bounds = `update ops.rooms set bounds = '[[0,0],[1,0],[1,1]]' where id = 'room-1'`;
  await scenario(ids, "admin redraws a room", "admin", null, q(bounds), rows(1));
  await scenario(ids, "social worker cannot redraw a room", "social_worker", null, q(bounds), denied);
  await scenario(ids, "a room polygon needs three points", "admin", null, q(`update ops.rooms set bounds = '[[0,0],[1,1]]' where id = 'room-1'`), checkFailed);
  await scenario(ids, "admin cannot add a room by hand", "admin", null, q("insert into ops.rooms (id, name) values ('room-9', 'Room 9')"), denied);

  // --- custom labels (0048) ------------------------------------------------------------
  // The fixture is stamped a minute in the past: the whole run is one
  // transaction, so now() is frozen and a default-stamped row could never
  // read as "bumped" after an update.
  const LABEL = "00000000-0000-4000-8000-0000000000c1";
  const seedLabel = () =>
    client.query(
      "insert into ops.floor_plan_labels (id, text, x, y, created_at, updated_at) values ($1, 'Nurse station', 0.5, 0.5, now() - interval '1 minute', now() - interval '1 minute')",
      [LABEL]
    );
  const insertLabel = "insert into ops.floor_plan_labels (text, x, y) values ('Exit', 0.1, 0.9) returning id";
  const editLabel = "update ops.floor_plan_labels set text = 'Nurse desk', rotation_deg = 90, font_size = 20 where id = $1";
  await scenario(ids, "social worker reads the labels", "social_worker", { setup: seedLabel }, q("select id from ops.floor_plan_labels where id = $1", [LABEL]), rows(1));
  await scenario(ids, "driver reads the labels", "driver", { setup: seedLabel }, q("select id from ops.floor_plan_labels where id = $1", [LABEL]), rows(1));
  await scenario(ids, "no session reads no labels", null, { setup: seedLabel }, q("select id from ops.floor_plan_labels where id = $1", [LABEL]), rows(0));
  await scenario(ids, "admin adds a label", "admin", null, q(insertLabel), rows(1));
  await scenario(ids, "admin edits a label", "admin", { setup: seedLabel }, q(editLabel, [LABEL]), rows(1));
  await scenario(ids, "admin deletes a label", "admin", { setup: seedLabel }, q("delete from ops.floor_plan_labels where id = $1", [LABEL]), rows(1));
  await scenario(ids, "social worker cannot add a label", "social_worker", null, q(insertLabel), denied);
  await scenario(ids, "house staff cannot add a label", "house_staff", null, q(insertLabel), denied);
  await scenario(ids, "social worker cannot edit a label", "social_worker", { setup: seedLabel }, q(editLabel, [LABEL]), rows(0));
  await scenario(ids, "social worker cannot delete a label", "social_worker", { setup: seedLabel }, q("delete from ops.floor_plan_labels where id = $1", [LABEL]), rows(0));
  await scenario(ids, "a label needs text", "admin", null, q("insert into ops.floor_plan_labels (text, x, y) values ('   ', 0.1, 0.1)"), checkFailed);
  await scenario(ids, "a label stays on the plan", "admin", null, q("insert into ops.floor_plan_labels (text, x, y) values ('Off', 1.5, 0.1)"), checkFailed);
  await scenario(ids, "a label's font size is bounded", "admin", null, q("insert into ops.floor_plan_labels (text, x, y, font_size) values ('Big', 0.1, 0.1, 60)"), checkFailed);
  await scenario(ids, "editing a label stamps updated_at", "admin", { setup: seedLabel }, q("update ops.floor_plan_labels set text = 'x' where id = $1 returning updated_at > created_at as bumped", [LABEL]), value("bumped", true));

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
