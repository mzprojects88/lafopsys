// Proves shared.module_access and the module policies of 0050 against the
// live database: the seed keeps what each role could do before, and changing
// a level in the grid changes what the database allows. One scenario per
// transaction, every transaction rolled back. Same harness as
// scripts/rls/floor-plan-policy-matrix.mjs; RLS_ALLOW_PROD=1 acknowledges
// that lafopsys has one database.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/module-access-matrix.mjs
// Pre-flight (before 0049/0050 are applied, one rolled-back transaction):
//   RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/module-access-matrix.mjs supabase/migrations/0049_check_in.sql supabase/migrations/0050_module_access.sql
import { pgUrl } from "../lib/db-url.mjs";
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
const client = new Client({
  connectionString: pgUrl(password),
});

const ROLES = ["admin", "social_worker", "house_staff", "driver", "finance", "board", "volunteer", "chef"];
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
    // Prepared plpgsql expressions from the fixtures (run as postgres) would skip the acting
    // role's EXECUTE checks for the rest of the transaction (laf-inventory 0051).
    await client.query("discard plans");

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
const rows = (n) => (r) => r.ok && r.rows === n;
const atLeast = (n) => (r) => r.ok && r.rows >= n;
const value = (field, v) => (r) => r.ok && r.rows === 1 && r.data[0][field] === v;

const q = (sql, params) => () => client.query(sql, params);
// Several statements; the outcome is the last one.
const last = (...steps) => async () => {
  let r;
  for (const st of steps) r = await client.query(st.sql, st.params);
  return r;
};

const PREFLIGHT = process.argv.slice(2);

// Fixtures: one patient (for reads and appointment inserts) and B1 unlocked.
const PT = "00000000-0000-4000-8000-0000000000d1";
const seedPatient = async () => {
  await client.query("update ops.units set status = 'available', lock_reason = null where id = 'unit-B1'");
  await client.query(
    `insert into ops.patients (id, patient_number, first_name, last_name, sex, status, admitted_at)
     values ($1, 'RLSTEST-MA1', 'Access', 'Test', 'F', 'ongoing', current_date)`,
    [PT]
  );
};
const setLevel = (role, module, level) =>
  client.query(
    `insert into shared.module_access (role, module, level) values ($1, $2, $3)
     on conflict (role, module) do update set level = excluded.level`,
    [role, module, level]
  );
const withPatient = (extra) => ({
  setup: async () => {
    await seedPatient();
    if (extra) await extra();
  },
});
const insertAppt = `insert into ops.appointments (patient_id, date, time, clinic, purpose) values ('${PT}', current_date + 1, '08:00', 'NCH', 'Test')`;
const readPatient = `select id from ops.patients where id = '${PT}'`;
const checkIn = `select ops.check_in(p_rules_discussed => true, p_unit_id => 'unit-B1', p_check_in_at => (now() at time zone 'Asia/Manila')::date, p_patient_id => '${PT}')`;
const lock = "update ops.units set status = 'maintenance', lock_reason = 'Broken slat' where id = 'unit-B1'";

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

  // --- the seed keeps today's behaviour ----------------------------------------
  await scenario(ids, "social worker reads a patient", "social_worker", withPatient(), q(readPatient), rows(1));
  await scenario(ids, "social worker books an appointment", "social_worker", withPatient(), q(insertAppt), rows(1));
  await scenario(ids, "social worker checks a patient in", "social_worker", withPatient(), q(checkIn), rows(1));
  await scenario(ids, "social worker locks a bed", "social_worker", null, q(lock), rows(1));
  await scenario(ids, "driver reads a patient through House Operations", "driver", withPatient(), q(readPatient), rows(1));
  await scenario(ids, "house staff reads a patient through House Operations", "house_staff", withPatient(), q(readPatient), rows(1));
  await scenario(ids, "driver cannot book an appointment", "driver", withPatient(), q(insertAppt), denied);
  await scenario(ids, "driver cannot check a patient in", "driver", withPatient(), q(checkIn), denied);
  // A view-only session's UPDATE matches no row (RLS filters it): refused, silently.
  await scenario(ids, "house staff can no longer lock a bed", "house_staff", null, q(lock), rows(0));
  await scenario(ids, "volunteer reads no patients", "volunteer", withPatient(), q(readPatient), rows(0));
  await scenario(ids, "board reads no patients", "board", withPatient(), q(readPatient), rows(0));
  await scenario(ids, "house staff reads no house sheet", "house_staff", null, q("select id from ops.house_sheet_people"), rows(0));
  await scenario(ids, "social worker reads the house sheet", "social_worker", null, q("select id from ops.house_sheet_people"), atLeast(1));
  await scenario(ids, "volunteer still reads the diagnosis list", "volunteer", null, q("select id from ops.diagnoses"), atLeast(1));
  await scenario(ids, "social worker cannot add a diagnosis", "social_worker", null,
    q("insert into ops.diagnoses (id, name, category) values ('dx-rlstest', 'Test', 'other')"), denied);
  await scenario(ids, "board reads bank transactions", "board", null, q("select id from ops.bank_transactions limit 1"), atLeast(0));
  await scenario(ids, "board cannot write a month note", "board", null,
    q("insert into ops.finance_month_notes (month, drivers) values ('2020-01', 'x')"), denied);
  // 0088 closes ops.donors itself to inventory roles; names come through the directory (0087).
  await scenario(ids, "chef still reads donor names (the directory, laf-inventory)", "chef", null, q("select id from ops.donor_directory(null, null, null, 1)"), rows(1));
  await scenario(ids, "house staff cannot add a calendar event", "house_staff", null,
    q("insert into ops.calendar_events (date, title) values (current_date, 'x')"), denied);
  await scenario(ids, "board cannot upload a patient file", "board", null, q("select shared.file_write_allowed('patients') as ok"), value("ok", false));
  await scenario(ids, "social worker can upload a patient file", "social_worker", null, q("select shared.file_write_allowed('patients') as ok"), value("ok", true));

  // --- the grid changes what the database allows --------------------------------
  await scenario(ids, "social worker set to View reads but cannot write", "social_worker",
    withPatient(() => setLevel("social_worker", "patients", "view")), q(readPatient), rows(1));
  await scenario(ids, "social worker set to View cannot book", "social_worker",
    withPatient(() => setLevel("social_worker", "patients", "view")), q(insertAppt), denied);
  await scenario(ids, "social worker set to View cannot check in", "social_worker",
    withPatient(() => setLevel("social_worker", "patients", "view")), q(checkIn), denied);
  await scenario(ids, "social worker set to View cannot lock a bed", "social_worker",
    { setup: () => setLevel("social_worker", "patients", "view") }, q(lock), rows(0));
  // Resident data is readable from Patients OR House Operations, so both go.
  await scenario(ids, "social worker set to None on both reads nothing", "social_worker",
    withPatient(async () => {
      await setLevel("social_worker", "patients", "none");
      await setLevel("social_worker", "house_ops", "none");
    }), q(readPatient), rows(0));
  await scenario(ids, "social worker with only House Operations still reads residents", "social_worker",
    withPatient(() => setLevel("social_worker", "patients", "none")), q(readPatient), rows(1));
  await scenario(ids, "driver given Patients edit can book", "driver",
    withPatient(() => setLevel("driver", "patients", "edit")), q(insertAppt), rows(1));
  await scenario(ids, "house staff given Calendar edit adds an event", "house_staff",
    { setup: () => setLevel("house_staff", "calendar", "edit") },
    q("insert into ops.calendar_events (date, title) values (current_date, 'x')"), rows(1));

  // --- the grid itself -------------------------------------------------------------
  await scenario(ids, "admin changes a level and is stamped", "admin", null,
    q("update shared.module_access set level = 'view' where role = 'driver' and module = 'house_ops' returning updated_by"),
    (r) => value("updated_by", ids.admin)(r));
  await scenario(ids, "admin cannot demote admin", "admin", null,
    q("update shared.module_access set level = 'view' where role = 'admin' and module = 'patients'"), checkFailed);
  await scenario(ids, "social worker cannot change the grid", "social_worker", null,
    q("update shared.module_access set level = 'edit' where role = 'social_worker' and module = 'settings'"), rows(0));
  await scenario(ids, "social worker cannot grant itself a module", "social_worker", null,
    q("insert into shared.module_access (role, module, level) values ('social_worker', 'finance', 'edit')"), denied);
  await scenario(ids, "Settings cannot be opened to another role", "admin", null,
    q("insert into shared.module_access (role, module, level) values ('social_worker', 'settings', 'view')"), checkFailed);
  await scenario(ids, "an unknown module is refused", "admin", null,
    q("insert into shared.module_access (role, module, level) values ('driver', 'payroll', 'view')"), checkFailed);

  // --- 0073: more than one role --------------------------------------------------
  const withExtra = (role, extra, more) => ({
    setup: async () => {
      await client.query("update shared.staff set extra_roles = $2 where id = $1", [ids[role], extra]);
      if (more) await more();
    },
  });
  const selfPromote = (role) => q("update shared.staff set extra_roles = '{admin}' where id = $1", [ids[role]]);
  const refusedOrNoRow = (r) => (!r.ok && r.code === "42501") || (r.ok && r.rows === 0);
  await scenario(ids, "a social worker cannot give themselves the admin role", "social_worker", null, selfPromote("social_worker"), refusedOrNoRow);
  await scenario(ids, "a driver cannot give themselves the admin role", "driver", null, selfPromote("driver"), refusedOrNoRow);
  await scenario(ids, "a chef cannot give themselves the admin role", "chef", null, selfPromote("chef"), refusedOrNoRow);
  await scenario(ids, "a driver with Social Worker added can book an appointment", "driver",
    withPatient(() => client.query("update shared.staff set extra_roles = '{social_worker}' where id = $1", [ids.driver])), q(insertAppt), rows(1));
  await scenario(ids, "a driver with Social Worker added keeps driving (Transport edit)", "driver",
    withExtra("driver", ["social_worker"]), q("select shared.module_level('transport') as l"), value("l", "edit"));
  // 0074: Super Admin is a main role only (server checks read the main role).
  await scenario(ids, "Super Admin can't be an additional role", "admin", null,
    async () => {
      await client.query("reset role");
      return client.query("update shared.staff set extra_roles = '{admin}' where id = $1", [ids.social_worker]);
    }, checkFailed);
  await scenario(ids, "the Office Admin role runs HR", "driver", withExtra("driver", ["office_admin"]), q("select hr.is_hr_staff() as ok"), value("ok", true));
  await scenario(ids, "a driver alone does not run HR", "driver", null, q("select hr.is_hr_staff() as ok"), value("ok", false));
  const asServer = (sql, params) => async () => {
    await client.query("reset role");
    return client.query(sql, params);
  };
  await scenario(ids, "even an admin session can't write staff roles (server only)", "admin", null,
    q("update shared.staff set extra_roles = '{driver}' where id = $1", [ids.social_worker]), denied);
  await scenario(ids, "the server gives someone an additional role", "admin", null,
    asServer("update shared.staff set extra_roles = '{driver}' where id = $1", [ids.social_worker]), rows(1));
  await scenario(ids, "an additional role can't repeat the main role", "admin", null,
    asServer("update shared.staff set extra_roles = '{social_worker}' where id = $1", [ids.social_worker]), checkFailed);
  await scenario(ids, "an unknown additional role is refused", "admin", null,
    asServer("update shared.staff set extra_roles = '{superuser}' where id = $1", [ids.social_worker]), checkFailed);
  await scenario(ids, "the new roles are accepted as a main role", "admin", null,
    asServer("update shared.staff set role = 'office_admin' where id = $1", [ids.social_worker]), rows(1));
  await scenario(ids, "nobody signed in has no role", null, null, q("select shared.has_role('admin', 'finance') as ok"), value("ok", false));
  await scenario(ids, "a chef reads the hospital list now (any staff)", "chef", null, q("select id from ops.hospitals limit 1"), atLeast(0));
  // --- 0075: what the Office Admin opens (a chef who also holds it) ----------------
  const asOfficeAdmin = (more) => withExtra("chef", ["office_admin"], more);
  await scenario(ids, "a chef alone reads no patients", "chef", withPatient(), q(readPatient), rows(0));
  await scenario(ids, "with Office Admin added they read a patient", "chef", asOfficeAdmin(seedPatient), q(readPatient), rows(1));
  await scenario(ids, "with Office Admin added they book an appointment", "chef", asOfficeAdmin(seedPatient), q(insertAppt), rows(1));
  await scenario(ids, "with Office Admin added they edit finance", "chef", asOfficeAdmin(), q("select shared.module_level('finance') as l"), value("l", "edit"));
  await scenario(ids, "with Office Admin added they edit donors", "chef", asOfficeAdmin(), q("select shared.module_level('donors') as l"), value("l", "edit"));
  await scenario(ids, "the Office Admin does not open Settings", "chef", asOfficeAdmin(), q("select shared.module_level('settings') as l"), value("l", "none"));
  await scenario(ids, "the Office Admin prepares Reports (0108 roll-out)", "chef", asOfficeAdmin(), q("select shared.module_level('reports') as l"), value("l", "edit"));
  await scenario(ids, "the Office Admin does not open Transport", "chef", asOfficeAdmin(), q("select shared.module_level('transport') as l"), value("l", "none"));
  await scenario(ids, "the Office Admin cannot change the grid", "chef", asOfficeAdmin(),
    q("update shared.module_access set level = 'edit' where role = 'office_admin' and module = 'reports'"), rows(0));

  // --- 0091: one person's overrides, the account event log, removing an unused account --------
  const has0091 = (await client.query("select to_regclass('shared.staff_module_access') is not null as y")).rows[0].y;
  if (has0091) {
    const override = (role, module, level) => ({
      setup: async () => {
        await seedPatient();
        await client.query("insert into shared.staff_module_access (staff_id, module, level) values ($1, $2, $3)", [ids[role], module, level]);
      },
    });
    await scenario(ids, "0091: a board member with Patients raised to View reads a patient", "board", override("board", "patients", "view"), q(readPatient), rows(1));
    // Patient rows open to Patients OR House Operations (0050), so the social worker is checked on
    // the level itself and the row test uses a module without a sibling.
    await scenario(ids, "0091: a social worker with Patients lowered to None has no Patients level", "social_worker", override("social_worker", "patients", "none"), q("select shared.module_level('patients') as l"), value("l", "none"));
    await scenario(ids, "0091: a board member with Finance lowered to None reads no bank line", "board", override("board", "finance", "none"), q("select id from ops.bank_transactions limit 1"), rows(0));
    await scenario(ids, "0091: a driver with Patients raised to Edit books an appointment", "driver", override("driver", "patients", "edit"), q(insertAppt), rows(1));
    await scenario(ids, "0091: an override on one module leaves the others as the roles have them", "board", override("board", "patients", "view"), q("select shared.module_level('finance') as l"), value("l", "view"));
    await scenario(ids, "0091: an admin cannot be given an override", "admin", null,
      q("insert into shared.staff_module_access (staff_id, module, level) values ($1, 'patients', 'none')", [ids.admin]), checkFailed);
    await scenario(ids, "0091: Settings cannot be overridden", "admin", null,
      q("insert into shared.staff_module_access (staff_id, module, level) values ($1, 'settings', 'view')", [ids.driver]), checkFailed);
    await scenario(ids, "0091: a person cannot set their own override", "driver", null,
      q("insert into shared.staff_module_access (staff_id, module, level) values ($1, 'patients', 'edit')", [ids.driver]), denied);
    await scenario(ids, "0091: a person reads their own override and nobody else's", "driver", {
      setup: async () => {
        await client.query("insert into shared.staff_module_access (staff_id, module, level) values ($1, 'patients', 'view'), ($2, 'patients', 'view')", [ids.driver, ids.board]);
      },
    }, q("select staff_id from shared.staff_module_access"), rows(1));
    await scenario(ids, "0091: an admin reads the account event log", "admin", {
      setup: async () => {
        await client.query("insert into shared.staff_events (staff_id, staff_name, action, actor_id, actor_name) values ($1, 'Test', 'pin_reset', $2, 'Admin')", [ids.driver, ids.admin]);
      },
    }, q("select id from shared.staff_events"), atLeast(1));
    await scenario(ids, "0091: a non-admin reads no account events", "finance", null, q("select id from shared.staff_events"), rows(0));
    await scenario(ids, "0091: nobody rewrites the account event log", "admin", null, q("delete from shared.staff_events"), denied);
    await scenario(ids, "0091: an account with a time entry cannot be removed", "admin", {
      setup: async () => {
        await client.query("insert into ops.time_entries (staff_id, date, clock_in) values ($1, current_date, '08:00')", [ids.driver]);
      },
    }, q("select shared.delete_unused_staff($1)", [ids.driver]), (r) => !r.ok && r.code === "23503");
    await scenario(ids, "0091: an account with no record is removed", "admin", {
      setup: async () => {
        await client.query(
          `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
           values ('00000000-0000-4000-8000-00000000a091', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rlstest-unused@staff.lafopsys.internal', now(), now())`
        );
        await client.query(
          `insert into shared.staff (id, staff_code, first_name, last_name, role, position, active, must_change_pin)
           values ('00000000-0000-4000-8000-00000000a091', 'RLSTEST-UNUSED', 'Unused', 'Account', 'driver', 'test', true, true)`
        );
        await client.query("insert into inventory.staff_house (staff_id, house_id) values ('00000000-0000-4000-8000-00000000a091', 'house-laf-main')");
      },
    }, async () => {
      await client.query("select shared.delete_unused_staff('00000000-0000-4000-8000-00000000a091')");
      return client.query("select id from shared.staff where id = '00000000-0000-4000-8000-00000000a091'");
    }, rows(0));
    await scenario(ids, "0091: a non-admin cannot remove an account", "finance", null, q("select shared.delete_unused_staff($1)", [ids.driver]), denied);
    await scenario(ids, "0091: an admin cannot remove themselves", "admin", null, q("select shared.delete_unused_staff($1)", [ids.admin]), (r) => !r.ok && r.code === "22023");
  }

  // --- 0093: roles you create, page levels, powers ----------------------------------------------
  const has0093 = (await client.query("select to_regclass('shared.roles') is not null as y")).rows[0].y;
  if (has0093) {
    const relief = async () => {
      await client.query("insert into shared.roles (key, name) values ('role-relief-driver', 'Relief Driver')");
      await client.query("insert into shared.role_page_access (role, page, level) values ('role-relief-driver', 'transport.trips', 'edit'), ('role-relief-driver', 'patients.manifest', 'view')");
      await client.query("insert into shared.role_powers (role, power) values ('role-relief-driver', 'driver')");
      await client.query("update shared.staff set role = 'role-relief-driver', extra_roles = '{}' where id = $1", [ids.board]);
    };
    // Role columns on shared.staff are written by the server (service role), so the constraints are checked as postgres.
    const asPostgres = (sql, params) => async () => {
      await client.query("reset role");
      return client.query(sql, params);
    };
    const asRelief = (extra) => ({ setup: async () => { await relief(); if (extra) await extra(); } });
    await scenario(ids, "0093: today's grid is unchanged (driver edits transport)", "driver", null, q("select shared.module_level('transport') as l"), value("l", "edit"));
    await scenario(ids, "0093: a page level drives the menu level (Relief Driver: transport edit)", "board", asRelief(), q("select shared.module_level('transport') as l"), value("l", "edit"));
    await scenario(ids, "0093: ...and a View page gives the menu View (patients)", "board", asRelief(), q("select shared.module_level('patients') as l"), value("l", "view"));
    await scenario(ids, "0093: ...and nothing else (finance none)", "board", asRelief(), q("select shared.module_level('finance') as l"), value("l", "none"));
    await scenario(ids, "0093: the custom role reads patients (View) but cannot book", "board", asRelief(seedPatient), q(insertAppt), denied);
    await scenario(ids, "0093: lowering the page lowers the menu", "board",
      asRelief(() => client.query("update shared.role_page_access set level = 'view' where role = 'role-relief-driver' and page = 'transport.trips'")),
      q("select shared.module_level('transport') as l"), value("l", "view"));
    await scenario(ids, "0093: a custom role holds a power it is given", "board", asRelief(), q("select shared.has_power('driver') as ok"), value("ok", true));
    await scenario(ids, "0093: ...and not one it is not", "board", asRelief(), q("select shared.has_power('bed_exception') as ok"), value("ok", false));
    await scenario(ids, "0093: the bed-exception power lets a custom role allow one", "board",
      asRelief(() => client.query("insert into shared.role_powers (role, power) values ('role-relief-driver', 'bed_exception')")),
      q("select ops.can_allow_bed_exception() as ok"), value("ok", true));
    await scenario(ids, "0093: social workers keep the bed-exception power", "social_worker", null, q("select ops.can_allow_bed_exception() as ok"), value("ok", true));
    await scenario(ids, "0093: a driver does not have it", "driver", null, q("select ops.can_allow_bed_exception() as ok"), value("ok", false));
    await scenario(ids, "0093: Office Admin runs HR through the power", "chef", asOfficeAdmin(), q("select hr.is_hr_staff() as ok"), value("ok", true));
    await scenario(ids, "0093: finance reads everyone's punches", "finance", null, q("select shared.has_power('finance_work') as ok"), value("ok", true));
    await scenario(ids, "0093: a social worker cannot add a bed (no layout power)", "social_worker", null, q("select ops.create_bed('B98', null, null, null, 0)"), denied);
    await scenario(ids, "0093: the admin creates a role, copying a driver's access", "admin", null,
      last({ sql: "select shared.create_role('Relief Driver', 'Covers weekends', 'driver') as k" }, { sql: "select count(*)::int as n from shared.role_page_access where role = 'role-relief-driver'" }),
      (r) => r.ok && r.data[0].n > 0);
    await scenario(ids, "0093: only the admin creates roles", "finance", null, q("select shared.create_role('X', null, null)"), denied);
    await scenario(ids, "0093: nobody but the admin sets page levels", "finance", null, q("insert into shared.role_page_access (role, page, level) values ('finance', 'patients.all', 'edit')"), denied);
    await scenario(ids, "0093: the Super Admin's pages cannot be set", "admin", null, q("insert into shared.role_page_access (role, page, level) values ('admin', 'patients.all', 'view')"), checkFailed);
    await scenario(ids, "0093: a built-in role cannot be archived", "admin", null, q("update shared.roles set archived_at = now() where key = 'driver'"), checkFailed);
    await scenario(ids, "0093: a role someone holds cannot be archived", "admin", asRelief(), q("update shared.roles set archived_at = now() where key = 'role-relief-driver'"), checkFailed);
    await scenario(ids, "0093: an outside role is never an additional role", "admin", null, asPostgres("update shared.staff set extra_roles = '{partner_viewer}' where id = $1", [ids.driver]), checkFailed);
    await scenario(ids, "0093: an unknown role is refused", "admin", null, asPostgres("update shared.staff set role = 'role-nope' where id = $1", [ids.driver]), (r) => !r.ok && r.code === "23503");
  }

  // 0102: House Operations reads LAF Inventory's meals and Care Cart runs, read only.
  if ((await client.query("select to_regprocedure('ops.house_meals(date,date)') is not null as ok")).rows[0].ok) {
    const meal = async () => {
      await client.query(`insert into inventory.meal_services (id, date, meal_type, patients, carers, others, dish) values ('T-MEAL', '2001-01-02', 'lunch', 3, 2, 1, 'Adobo')`);
    };
    await scenario(ids, "0102: house staff see the kitchen's meals", "house_staff", { setup: meal },
      q("select served, dish from ops.house_meals('2001-01-01', '2001-01-31')"), (r) => r.ok && r.data?.[0]?.served === 6 && r.data[0].dish === "Adobo");
    await scenario(ids, "0102: the driver (House Ops) sees the Care Cart", "driver", null, q("select * from ops.house_care_cart('2001-01-01', '2001-01-31')"), (r) => r.ok);
    await scenario(ids, "0102: finance (no House Ops) sees no meals", "finance", { setup: meal }, q("select * from ops.house_meals('2001-01-01', '2001-01-31')"), denied);
  }
  if ((await client.query("select to_regprocedure('ops.house_stock_status()') is not null as ok")).rows[0].ok) {
    await scenario(ids, "0106: the driver (House Ops) sees the Operations Stocks boxes", "driver", null, q("select line_name, status from ops.house_stock_status() where line_id = 'hsl-rice'"), (r) => r.ok && r.data?.[0]?.line_name === "Rice");
    await scenario(ids, "0106: finance (no House Ops) sees no stocks", "finance", null, q("select * from ops.house_stock_status()"), denied);
  } else record("0102 scenarios", "SKIP", "0102 not applied (pass it as a pre-flight file)");
  // 0110: the Donation Tracker's deposits and sync runs are read by Donors / Finance viewers only; nobody writes them from a session.
  if ((await client.query("select to_regclass('ops.cash_deposits') is not null as ok")).rows[0].ok) {
    const deposit = async () => {
      await client.query(`insert into ops.cash_deposits (year, line_key, deposit_date, amount, donor_name, invoice_number) values (2001, 'T-DEP', '2001-01-05', 1500, 'Test Donor', 'SI-T-1')`);
    };
    await scenario(ids, "0110: finance reads the tracker's deposits", "finance", { setup: deposit }, q("select amount from ops.cash_deposits where line_key = 'T-DEP'"), rows(1));
    await scenario(ids, "0110: the chef (no Donors, no Finance) sees no deposits", "chef", { setup: deposit }, q("select amount from ops.cash_deposits where line_key = 'T-DEP'"), rows(0));
    await scenario(ids, "0110: finance can't write a deposit", "finance", null, q("insert into ops.cash_deposits (year, line_key, deposit_date, amount) values (2001, 'T-DEP2', '2001-01-06', 10)"), denied);
    await scenario(ids, "0110: a donors viewer can't issue receipts in bulk", "board", null, q("select ops.issue_cash_ars_for_unreceipted()"), denied);
  }
  // 0111: reconciliation is for finance or donors editors; the automatic pass as well.
  if ((await client.query("select to_regprocedure('ops.reconcile_bank_credit(uuid,uuid,uuid,boolean)') is not null as ok")).rows[0].ok) {
    const credit = async () => {
      await client.query(`insert into ops.bank_transactions (id, account_id, import_id, row_seq, posting_date, description, debit, credit, running_balance)
        values ('00000000-0000-0000-0000-00000000d101', (select id from ops.accounts limit 1), (select id from ops.bank_statement_imports limit 1), 9101, '2001-01-11', 'IBFT test', 0, 500, 1)`);
    };
    await scenario(ids, "0111: finance marks a bank credit as not a donation", "finance", { setup: credit },
      q("select ops.reconcile_bank_credit('00000000-0000-0000-0000-00000000d101', null, null, true); select category, needs_review from ops.bank_transactions where id = '00000000-0000-0000-0000-00000000d101'"), (r) => r.ok);
    await scenario(ids, "0111: the chef can't reconcile", "chef", { setup: credit }, q("select ops.reconcile_bank_credit('00000000-0000-0000-0000-00000000d101', null, null, true)"), denied);
    await scenario(ids, "0111: a board member can't run the automatic pass", "board", null, q("select ops.auto_reconcile_cash()"), denied);
  }
  // 0112: the Programs report is for Reports viewers; prior-year totals are typed by finance work or admin.
  if ((await client.query("select to_regprocedure('ops.program_impact(integer)') is not null as ok")).rows[0].ok) {
    await scenario(ids, "0112: a board member (Reports view) reads the Programs report", "board", null, q("select count(*)::int as n from ops.program_impact(2026)"), value("n", 180));
    await scenario(ids, "0112: the chef (no Reports) can't read the Programs report", "chef", null, q("select * from ops.program_impact(2026)"), denied);
    await scenario(ids, "0112: finance (finance work) types a prior-year total", "finance", null, q("insert into ops.program_history (year, line, value) values (2024, 'housing', 10) returning value"), rows(1));
    await scenario(ids, "0112: the driver can't type prior years", "driver", null, q("insert into ops.program_history (year, line, value) values (2024, 'meals', 10)"), denied);
    await scenario(ids, "0112: nobody calls the website figures from a session", "finance", null, q("select ops.website_dashboard()"), denied);
  }
  // 0113: the Executive summary's drivers are confirmed by the CEO, finance or the Super Admin; the month's facts are theirs to read.
  if ((await client.query("select to_regprocedure('ops.confirm_month_drivers(text,text)') is not null as ok")).rows[0].ok) {
    await scenario(ids, "0113: the CEO confirms a month's drivers", "ceo", null, q("select ops.confirm_month_drivers('2001-01', 'Quiet month.')"), rows(1));
    // The power row is seeded in the scenario's own transaction: on dev the live rows are kept off until prod has 0113.
    await scenario(ids, "0113: finance confirms a month's drivers", "finance", { setup: () => client.query("insert into shared.role_powers (role, power) values ('finance', 'confirm_summary') on conflict do nothing") },
      q("select ops.confirm_month_drivers('2001-02', 'Quiet month.')"), rows(1));
    await scenario(ids, "0113: the chef can't confirm", "chef", null, q("select ops.confirm_month_drivers('2001-03', 'Quiet month.')"), denied);
    await scenario(ids, "0113: the CEO reads the month's facts", "ceo", null, q("select (ops.month_driver_facts('2026-01') ? 'totals') as ok"), value("ok", true));
    await scenario(ids, "0113: the driver can't read the month's facts", "driver", null, q("select ops.month_driver_facts('2026-01')"), denied);
  }
  // 0114: finance tags what a debit paid for; the monthly note is read by finance and executive viewers only.
  if ((await client.query("select exists (select 1 from information_schema.columns where table_schema = 'ops' and table_name = 'bank_transactions' and column_name = 'purpose') as ok")).rows[0].ok) {
    await scenario(ids, "0114: finance confirms a debit's purpose", "finance", null,
      q("update ops.bank_transactions set purpose = 'Utilities', purpose_confirmed = true where id = (select id from ops.bank_transactions where debit > 0 order by posting_date limit 1) returning id"), rows(1));
    await scenario(ids, "0114: the driver can't tag a debit", "driver", null,
      q("update ops.bank_transactions set purpose = 'Other' where debit > 0 returning id"), (r) => denied(r) || (r.ok && r.rows === 0));
    await scenario(ids, "0114: the board reads the monthly notes", "board", null, q("select count(*)::int as n from ops.finance_month_notes"), (r) => r.ok && r.data[0].n > 0);
    await scenario(ids, "0114: the chef no longer reads the monthly notes", "chef", null, q("select count(*)::int as n from ops.finance_month_notes"), value("n", 0));
  }
  // 0115: finance keeps the accounts and the budget by purpose; cost per outcome is for finance viewers.
  if ((await client.query("select to_regprocedure('ops.cost_per_outcome(integer)') is not null as ok")).rows[0].ok) {
    await scenario(ids, "0115: finance adds a cash-on-hand account", "finance", null,
      q("insert into ops.accounts (name, entity, currency, balance, type, balance_as_of) values ('Matrix petty cash', 'PH_SEC', 'PHP', 500, 'cash_on_hand', current_date) returning id"), rows(1));
    await scenario(ids, "0115: finance budgets a purpose for a month", "finance", null,
      q("insert into ops.budget_lines (purpose, month, budgeted) values ('Utilities', '2001-01', 1000) on conflict (purpose, month) do update set budgeted = excluded.budgeted returning id"), rows(1));
    await scenario(ids, "0115: the driver can't budget", "driver", null, q("insert into ops.budget_lines (purpose, month, budgeted) values ('Utilities', '2001-01', 1000)"), denied);
    await scenario(ids, "0115: the board reads cost per outcome", "board", null, q("select count(*)::int as n from ops.cost_per_outcome(2026)"), value("n", 12));
    await scenario(ids, "0115: the chef can't read cost per outcome", "chef", null, q("select * from ops.cost_per_outcome(2026)"), denied);
  }
  // 0116: House Ops editors add volunteers and log hours; totals follow the log.
  if ((await client.query("select to_regclass('ops.volunteer_hours') is not null as ok")).rows[0].ok) {
    const volunteer = async () => {
      await client.query(`insert into ops.volunteers (id, first_name, last_name, focus_area) values ('00000000-0000-4000-8000-0000000000a1', 'Matrix', 'Volunteer', 'Care Cart')`);
    };
    await scenario(ids, "0116: the social worker adds a volunteer", "social_worker", null,
      q("insert into ops.volunteers (first_name, last_name, focus_area) values ('Matrix', 'Helper', 'Events') returning id"), rows(1));
    await scenario(ids, "0116: the social worker logs hours and the total follows", "social_worker", { setup: volunteer },
      last(
        { sql: "insert into ops.volunteer_hours (volunteer_id, date, hours, activity) values ('00000000-0000-4000-8000-0000000000a1', current_date - 1, 2, 'Care Cart'), ('00000000-0000-4000-8000-0000000000a1', current_date, 1.5, 'Events')" },
        { sql: "select total_hours::float as total, last_session_date = current_date as latest from ops.volunteers where id = '00000000-0000-4000-8000-0000000000a1'" }
      ),
      (r) => r.ok && r.data[0]?.total === 3.5 && r.data[0]?.latest === true);
    await scenario(ids, "0116: the chef can't log volunteer hours", "chef", { setup: volunteer },
      q("insert into ops.volunteer_hours (volunteer_id, date, hours, activity) values ('00000000-0000-4000-8000-0000000000a1', current_date, 1, 'Care Cart')"), denied);
  }
  // 0107: Activity Center sessions read from the LAF Programs sheet are ordinary sessions to House Ops viewers.
  if ((await client.query("select to_regclass('ops.activity_sessions') is not null and exists (select 1 from information_schema.columns where table_schema = 'ops' and table_name = 'activity_sessions' and column_name = 'sheet_key') as ok")).rows[0].ok) {
    const sheetSession = async () => {
      await client.query(`insert into ops.activity_sessions (date, title, participants, volunteer_count, hours, source, sheet_key) values ('2001-01-03', 'Activity Center @ NCH', 5, 1, 2, 'sheet', '2001-01-03|NCH')`);
    };
    await scenario(ids, "0107: house staff see a sheet session with its source", "house_staff", { setup: sheetSession },
      q("select participants, source from ops.activity_sessions where sheet_key = '2001-01-03|NCH'"), (r) => r.ok && r.data?.[0]?.participants === 5 && r.data[0].source === "sheet");
  }

  // 0117: a month closes only when its records are complete; a closed month is locked; only the Super Admin reopens.
  if ((await client.query("select to_regprocedure('ops.close_month(text)') is not null as ok")).rows[0].ok) {
    const power = () => client.query("insert into shared.role_powers (role, power) values ('finance', 'confirm_summary') on conflict do nothing");
    await scenario(ids, "0117: a month with no statement can't be closed", "finance", { setup: power }, q("select ops.close_month('2001-03')"), (r) => !r.ok && r.code === "23514");
    await scenario(ids, "0117: the driver can't close a month", "driver", null, q("select ops.close_month('2001-03')"), denied);
    await scenario(ids, "0117: a closed month's summary note is locked", "finance",
      { setup: async () => { await power(); await client.query("insert into ops.month_closes (month, closed, closed_at) values ('2001-04', true, now())"); } },
      q("select ops.confirm_month_drivers('2001-04', 'Late change.')"), denied);
    await scenario(ids, "0117: finance can't reopen a month", "finance",
      { setup: () => client.query("insert into ops.month_closes (month, closed, closed_at) values ('2001-05', true, now())") },
      q("select ops.reopen_month('2001-05', 'Bank fixed a line')"), denied);
    await scenario(ids, "0117: the chef can't read the close checklist", "chef", null, q("select ops.month_close_checklist('2026-07')"), denied);
  }

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
