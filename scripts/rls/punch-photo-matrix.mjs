// Proves 0060 (DTR punch photos) and 0063 (on-site check) against the live database, one scenario per
// transaction, every transaction rolled back: staff see their own punches
// (with location and photo_status) but never a photo row; admins and HR see
// every photo row; finance, though it reads all punches, sees no photo.
// Same harness as scripts/rls/floor-plan-policy-matrix.mjs.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/punch-photo-matrix.mjs
// Pre-flight: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/punch-photo-matrix.mjs supabase/migrations/0060_punch_photos.sql
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
const MINE = "00000000-0000-4000-8000-00000000d0a1";
const THEIRS = "00000000-0000-4000-8000-00000000d0a2";
// A punch and its photo for the acting social worker, and one for the driver.
const seedFor = (ids) => async () => {
  for (const [id, who] of [[MINE, ids.social_worker], [THEIRS, ids.driver]]) {
    await client.query(`insert into ops.time_punches (id, staff_id, punch_type, source, photo_status) values ($1, $2, 'clock_in', 'device', 'captured')`, [id, who]);
    await client.query(`insert into ops.time_punch_photos (punch_id, staff_id, object_key, bytes) values ($1, $2, $3, 5000)`, [id, who, `DTR photos/test/${id}.jpg`]);
  }
};
const hr = (ids, extra) => async () => {
  await seedFor(ids)();
  await client.query("update shared.staff set is_hr = true where id = $1", [ids.social_worker]);
  if (extra) await extra();
};

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

  await scenario(ids, "staff read their own punch, with its photo status", "social_worker", seeded,
    q(`select photo_status from ops.time_punches where id = '${MINE}'`), value("photo_status", "captured"));
  await scenario(ids, "staff never read their own photo row", "social_worker", seeded,
    q(`select object_key from ops.time_punch_photos where punch_id = '${MINE}'`), rows(0));
  await scenario(ids, "staff never read a colleague's photo row", "driver", seeded,
    q(`select object_key from ops.time_punch_photos`), rows(0));
  await scenario(ids, "finance reads punches but no photo", "finance", seeded,
    q(`select object_key from ops.time_punch_photos`), rows(0));
  await scenario(ids, "admins read every photo row", "admin", seeded,
    q(`select object_key from ops.time_punch_photos where punch_id in ('${MINE}', '${THEIRS}')`), rows(2));
  await scenario(ids, "HR (not admin) reads every photo row", "social_worker", { setup: hr(ids) },
    q(`select object_key from ops.time_punch_photos where punch_id in ('${MINE}', '${THEIRS}')`), rows(2));
  await scenario(ids, "staff file the photo of their own punch", "driver",
    { setup: () => client.query(`insert into ops.time_punches (id, staff_id, punch_type, source, photo_status) values ('${THEIRS}', $1, 'clock_in', 'device', 'captured')`, [ids.driver]) },
    q(`insert into ops.time_punch_photos (punch_id, staff_id, object_key, bytes) values ('${THEIRS}', '${ids.driver}', 'DTR photos/test/x.jpg', 5000)`), rows(1));
  await scenario(ids, "nobody files a photo against someone else's punch", "driver", seeded,
    q(`insert into ops.time_punch_photos (punch_id, staff_id, object_key, bytes) values ('${MINE}', '${ids.driver}', 'DTR photos/test/y.jpg', 5000)`), denied);
  await scenario(ids, "a photo row is never changed", "admin", seeded,
    q(`update ops.time_punch_photos set object_key = 'elsewhere' where punch_id = '${MINE}'`), denied);
  await scenario(ids, "a photo row is never deleted", "admin", seeded,
    q(`delete from ops.time_punch_photos where punch_id = '${MINE}'`), denied);
  await scenario(ids, "photo status is one of the five", "social_worker", {},
    q(`insert into ops.time_punches (staff_id, punch_type, source, photo_status) values ('${ids.social_worker}', 'clock_in', 'device', 'selfie')`), checkFailed);

  // ---- 0063: on-site check ----
  await scenario(ids, "staff cannot move the LAF House pin", "social_worker", {},
    q("update shared.app_settings set laf_house_latitude = 1, laf_house_longitude = 1 where id returning id"), (r) => (r.ok && r.rows === 0) || (!r.ok && r.code === "42501"));
  await scenario(ids, "admins set the pin", "admin", {},
    q("update shared.app_settings set laf_house_latitude = 14.627712, laf_house_longitude = 121.026051, laf_house_radius_m = 20 where id returning id"), rows(1));
  await scenario(ids, "a pin needs both coordinates", "admin", {},
    q("update shared.app_settings set laf_house_latitude = 14.6, laf_house_longitude = null where id"), checkFailed);
  await scenario(ids, "site status is one of the three", "social_worker", {},
    q(`insert into ops.time_punches (staff_id, punch_type, source, site_status) values ('${ids.social_worker}', 'clock_in', 'device', 'home')`), checkFailed);

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
