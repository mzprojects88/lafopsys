// Proves 0071 (a bed plan applied as one, checked on the end state, logged,
// only between the bed move hours) against the live database, one scenario
// per transaction, every transaction rolled back. Same harness as
// bed-rules-matrix.mjs: each scenario empties the house first and opens the
// move hours to the whole day, inside its own rolled-back transaction.
//
// Usage:      RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/bed-plan-matrix.mjs
// Pre-flight: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/bed-plan-matrix.mjs supabase/migrations/0071_bed_plans.sql
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

const ROLES = ["admin", "social_worker", "house_staff"];
const results = [];
const record = (name, verdict, detail = "") =>
  results.push({ scenario: name, result: verdict, detail: String(detail).replace(/\s+/g, " ").slice(0, 90) });

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

async function scenario(ids, name, actor, setup, body, expect) {
  if (actor && !ids[actor]) {
    record(name, "SKIP", `no ${actor} account`);
    return;
  }
  await client.query(PREFLIGHT.length ? "savepoint scenario" : "begin");
  try {
    if (actor) await client.query("update shared.staff set active = true, role = $2 where id = $1", [ids[actor], actor]);
    await emptyHouse();
    // Setup places families as the admin (check_in needs a signed-in editor).
    if (ids.admin) {
      await client.query("update shared.staff set active = true where id = $1", [ids.admin]);
      await client.query("select set_config('request.jwt.claims', $1, true)", [claims(ids.admin)]);
    }
    if (setup) await setup();
    await client.query("set local role authenticated");
    if (actor) await client.query("select set_config('request.jwt.claims', $1, true)", [claims(ids[actor])]);
    let outcome;
    try {
      const r = await body();
      outcome = { ok: true, rows: r.rowCount, data: r.rows };
    } catch (e) {
      outcome = { ok: false, code: e.code, msg: e.message };
    }
    record(name, expect(outcome) ? "PASS" : "FAIL", outcome.ok ? `ok ${JSON.stringify(outcome.data?.[0] ?? "")}` : `${outcome.code} ${outcome.msg}`);
  } catch (e) {
    record(name, "FAIL", `setup error: ${e.message}`);
  } finally {
    await client.query(PREFLIGHT.length ? "rollback to savepoint scenario" : "rollback");
  }
}

const denied = (r) => !r.ok && r.code === "42501";
const refused = (text) => (r) => !r.ok && r.code === "23514" && (!text || r.msg.includes(text));
const ok = (r) => r.ok;
const q = (sql) => () => client.query(sql);
const steps = (...sqls) => async () => {
  let r;
  for (const s of sqls) r = await client.query(s);
  return r;
};

// Fixtures: four children and their carers (F = mother, M = father);
// KID_D and KID_S are siblings (one family).
const TODAY = "(now() at time zone 'Asia/Manila')::date";
const id = (n) => `00000000-0000-4000-8000-0000000070${n}`;
const [KID_A, KID_B, KID_D, KID_S, KID_BOY] = [id("01"), id("02"), id("03"), id("04"), id("05")];
const [MOM_A, MOM_B, DAD_D, DAD_S] = [id("11"), id("12"), id("13"), id("14")];
const FAMILY = id("99");

async function emptyHouse() {
  await client.query("update shared.app_settings set bed_moves_from = '00:00', bed_moves_until = '23:59' where id");
  await client.query(`update ops.stays set status = 'checked_out', check_out_at = ${TODAY} where status in ('in_house', 'overdue')`);
  await client.query("update ops.bed_reservations set status = 'released', closed_at = now() where status = 'active'");
  await client.query("update ops.units set status = 'available', lock_reason = null where active");
  await client.query(
    `insert into ops.patients (id, first_name, last_name, sex, status, admitted_at, family_id) values
       ('${KID_A}', 'Rule', 'A', 'F', 'ongoing', current_date, null),
       ('${KID_B}', 'Rule', 'B', 'M', 'ongoing', current_date, null),
       ('${KID_D}', 'Rule', 'D', 'M', 'ongoing', current_date, '${FAMILY}'),
       ('${KID_S}', 'Rule', 'S', 'F', 'ongoing', current_date, '${FAMILY}'),
       ('${KID_BOY}', 'Rule', 'Boy', 'M', 'ongoing', current_date, null)`
  );
  await client.query(
    `insert into ops.carers (id, patient_id, name, relationship, effective_from, sex) values
       ('${MOM_A}', '${KID_A}', 'Mom A', 'Mother', current_date, 'F'),
       ('${MOM_B}', '${KID_B}', 'Mom B', 'Mother', current_date, 'F'),
       ('${DAD_D}', '${KID_D}', 'Dad D', 'Father', current_date, 'M'),
       ('${DAD_S}', '${KID_S}', 'Dad S', 'Father', current_date, 'M')`
  );
}

const checkIn = (kid, unit, carer, extra = "") =>
  `select ops.check_in(p_rules_discussed => true, p_unit_id => 'unit-${unit}', p_check_in_at => ${TODAY}, p_patient_id => '${kid}'${carer ? `, p_carer_id => '${carer}'` : ""}${extra})`;
const placed = (kid, unit, carer) => () => client.query(checkIn(kid, unit, carer));
const stayOf = (kid) => `(select id from ops.stays where patient_id = '${kid}' and status = 'in_house')`;

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

  // A family put straight on a bed (as the owner: no rules, like a stay from before them).
  const seat = (kid, unit, carer) =>
    client.query(`insert into ops.stays (patient_id, bed_position_id, carer_id, check_in_at, status) values ('${kid}', 'unit-${unit}-A', ${carer ? `'${carer}'` : "null"}, ${TODAY}, 'in_house')`);
  const lock = (...codes) => client.query(`update ops.units set status = 'maintenance', lock_reason = 'plan test' where id in (${codes.map((c) => `'unit-${c}'`).join(",")})`);
  const planSql = (...moves) =>
    `select ops.apply_bed_plan(jsonb_build_array(${moves
      .map(([kid, unit]) => `jsonb_build_object('stay_id', ${stayOf(kid)}, 'unit_id', 'unit-${unit}', 'reason', 'test')`)
      .join(", ")}), 'test plan') as id`;
  const unitOf = (kid) => `(select bp.unit_id from ops.stays s join ops.bed_positions bp on bp.id = s.bed_position_id where s.patient_id = '${kid}' and s.status = 'in_house')`;

  await scenario(ids, "a plan moves a woman from Room 2 up to Room 1, logged and tonight's bed", "social_worker",
    () => seat(KID_A, "B5", MOM_A),
    steps(planSql([KID_A, "B1"]),
      `select ${unitOf(KID_A)} as unit,
              (select count(*)::int from ops.bed_moves where stay_id = ${stayOf(KID_A)} and moved_by = auth.uid()) as logged,
              (select count(*)::int from ops.bed_nights where stay_id = ${stayOf(KID_A)} and night = ${TODAY}) as nights`),
    (r) => r.ok && r.data[0].unit === "unit-B1" && r.data[0].logged === 1 && r.data[0].nights === 1);
  await scenario(ids, "a plan that puts a man in the women's room is refused", "social_worker",
    async () => { await seat(KID_A, "B1", MOM_A); await seat(KID_D, "B5", DAD_D); },
    q(planSql([KID_D, "B2"])), refused("women's room"));
  await scenario(ids, "a swap applies as one (no free bed in between)", "social_worker",
    async () => {
      await seat(KID_D, "B1", DAD_D);
      await seat(KID_A, "B5", MOM_A);
      await lock("B2", "B3", "B4", "B6", "B7", "B8", "B9");
    },
    steps(planSql([KID_D, "B5"], [KID_A, "B1"]), `select ${unitOf(KID_A)} || '/' || ${unitOf(KID_D)} as s`),
    (r) => r.ok && r.data[0].s === "unit-B1/unit-B5");
  await scenario(ids, "two families on one bed are refused", "social_worker",
    async () => { await seat(KID_A, "B5", MOM_A); await seat(KID_B, "B6", MOM_B); },
    q(planSql([KID_A, "B1"], [KID_B, "B1"])), (r) => !r.ok && r.code === "23505");
  await scenario(ids, "a family twice in the plan is refused", "social_worker", () => seat(KID_A, "B5", MOM_A),
    q(planSql([KID_A, "B1"], [KID_A, "B2"])), (r) => !r.ok && r.code === "22023");
  await scenario(ids, "a locked bed is refused", "social_worker", async () => { await seat(KID_A, "B5", MOM_A); await lock("B1"); },
    q(planSql([KID_A, "B1"])), refused("locked"));
  await scenario(ids, "outside the bed move hours it waits", "social_worker",
    async () => {
      await seat(KID_A, "B5", MOM_A);
      await client.query("update shared.app_settings set bed_moves_from = '00:00', bed_moves_until = '00:01' where id");
    },
    q(planSql([KID_A, "B1"])), refused("Families are moved between"));
  await scenario(ids, "house staff cannot apply a plan", "house_staff", () => seat(KID_A, "B5", MOM_A), q(planSql([KID_A, "B1"])), denied);
  await scenario(ids, "nobody writes the move log directly", "admin", () => seat(KID_A, "B5", MOM_A),
    q(`insert into ops.bed_moves (plan_id, stay_id, to_unit_id, reason) values (gen_random_uuid(), ${stayOf(KID_A)}, 'unit-B1', 'x')`), denied);
  await scenario(ids, "patients staff read the move log", "social_worker", null, q("select count(*) from ops.bed_moves"), ok);
  await scenario(ids, "the move hours are read by everyone signed in", "house_staff", null,
    q("select bed_moves_from, bed_moves_until from shared.app_settings"), (r) => r.ok && r.rows === 1);

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
