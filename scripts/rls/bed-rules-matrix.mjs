// Proves 0070 (rooms filled in order, single-sex rooms by carer, family
// exception, logged exceptions by admin / inventory lead, every bed door
// guarded) against the live database, one scenario per transaction, every
// transaction rolled back. Same harness as bed-reservation-matrix.mjs.
// Each scenario first empties the house inside its own rolled-back
// transaction, so live families never decide a result.
//
// Usage:      RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/bed-rules-matrix.mjs
// Pre-flight: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/bed-rules-matrix.mjs supabase/migrations/0070_bed_rules.sql
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
  connectionString: `postgresql://postgres.kptftyuzrnummbcjakro:${encodeURIComponent(password)}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
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

  // ---- the carer's sex ----
  await scenario(ids, "a new carer needs their sex", "social_worker", null,
    q(`select ops.check_in(p_rules_discussed => true, p_unit_id => 'unit-B1', p_check_in_at => ${TODAY}, p_patient_id => '${KID_BOY}', p_carer_name => 'New Carer', p_carer_relationship => 'Guardian')`),
    refused("carer's sex"));
  await scenario(ids, "a new carer is saved with their sex", "social_worker", null,
    steps(`select ops.check_in(p_rules_discussed => true, p_unit_id => 'unit-B1', p_check_in_at => ${TODAY}, p_patient_id => '${KID_BOY}', p_carer_name => 'New Carer', p_carer_relationship => 'Guardian', p_carer_sex => 'M')`,
      `select sex from ops.carers where patient_id = '${KID_BOY}' and name = 'New Carer'`),
    (r) => r.ok && r.data[0]?.sex === "M");

  // ---- rooms in order ----
  await scenario(ids, "Room 1 is offered first", "social_worker", null, q(checkIn(KID_A, "B1", MOM_A)), ok);
  await scenario(ids, "Room 2 is refused while Room 1 has a free bed", "social_worker", null, q(checkIn(KID_A, "B5", MOM_A)), refused("Room 1 still has a free bed"));
  await scenario(ids, "Room 2 opens once Room 1 is full", "social_worker",
    async () => {
      await placed(KID_A, "B1", MOM_A)();
      for (const u of ["B2", "B3", "B4"]) await client.query(`update ops.units set status = 'maintenance', lock_reason = 'rule test' where id = 'unit-${u}'`);
    },
    q(checkIn(KID_B, "B5", MOM_B)), ok);

  // ---- single-sex rooms ----
  await scenario(ids, "a man carer cannot join a women's room", "social_worker", placed(KID_A, "B1", MOM_A), q(checkIn(KID_D, "B2", DAD_D)), refused("women's room"));
  await scenario(ids, "...so he goes to Room 2 though Room 1 has free beds", "social_worker", placed(KID_A, "B1", MOM_A), q(checkIn(KID_D, "B5", DAD_D)), ok);
  await scenario(ids, "...but not Room 3 while Room 2 is open to him", "social_worker", placed(KID_A, "B1", MOM_A), q(checkIn(KID_D, "B10", DAD_D)), refused("Room 2 still has a free bed"));
  await scenario(ids, "a child with no carer counts as their own sex", "social_worker", placed(KID_A, "B1", MOM_A), q(checkIn(KID_BOY, "B2", null)), refused("women's room"));
  await scenario(ids, "the same family may share a room", "social_worker",
    async () => {
      await client.query(checkIn(KID_S, "B1", DAD_S));
    },
    q(checkIn(KID_D, "B2", DAD_D)), ok);
  await scenario(ids, "a sibling's mother may join the father's room (family)", "social_worker",
    async () => {
      await client.query(`update ops.carers set sex = 'F', name = 'Mom S', relationship = 'Mother' where id = '${DAD_S}'`);
      await client.query(checkIn(KID_D, "B1", DAD_D));
    },
    q(checkIn(KID_S, "B2", DAD_S)), ok);

  // ---- exceptions ----
  const exception = (reason) => `, p_exception_reason => '${reason}'`;
  await scenario(ids, "a social worker cannot allow an exception", "social_worker", placed(KID_A, "B1", MOM_A), q(checkIn(KID_D, "B2", DAD_D, exception("house full"))), denied);
  await scenario(ids, "an admin allows one with a reason, and it is logged", "admin", placed(KID_A, "B1", MOM_A),
    steps(checkIn(KID_D, "B2", DAD_D, exception("house full, moving him tomorrow")),
      `select count(*)::int as n, min(reason) as reason, bool_and(allowed_by = auth.uid()) as mine from ops.bed_rule_exceptions where stay_id = ${stayOf(KID_D)}`),
    (r) => r.ok && r.data[0].n === 1 && r.data[0].mine === true);
  await scenario(ids, "an exception needs a reason", "admin", placed(KID_A, "B1", MOM_A), q(checkIn(KID_D, "B2", DAD_D, exception(" "))), refused("women's room"));
  await scenario(ids, "nobody writes the exceptions log directly", "admin", null,
    q(`insert into ops.bed_rule_exceptions (stay_id, unit_id, rule, reason) values (gen_random_uuid(), 'unit-B1', 'x', 'x')`), denied);
  await scenario(ids, "patients staff read the exceptions log", "social_worker", null, q("select count(*) from ops.bed_rule_exceptions"), ok);

  // ---- moving: Move tonight / Transfer bed ----
  await scenario(ids, "a move follows the room rule", "social_worker",
    async () => {
      await placed(KID_A, "B1", MOM_A)();
      await placed(KID_D, "B5", DAD_D)();
    },
    q(`select ops.confirm_night(${stayOf(KID_D)}, 'unit-B2')`), refused("women's room"));
  await scenario(ids, "a move within his own room is fine", "social_worker",
    async () => {
      await placed(KID_A, "B1", MOM_A)();
      await placed(KID_D, "B5", DAD_D)();
    },
    q(`select ops.confirm_night(${stayOf(KID_D)}, 'unit-B6')`), ok);
  await scenario(ids, "moving out of Room 1 leaves a bed there first", "social_worker", placed(KID_A, "B1", MOM_A),
    q(`select ops.confirm_night(${stayOf(KID_A)}, 'unit-B5')`), refused("Room 1 still has a free bed"));
  await scenario(ids, "the browser cannot write a stay's bed", "social_worker", placed(KID_A, "B1", MOM_A),
    q(`update ops.stays set bed_position_id = 'unit-B2-A' where id = ${stayOf(KID_A)}`), denied);

  // ---- holds ----
  const holdSql = (unit, kid, sex) =>
    `insert into ops.bed_reservations (unit_id, patient_id, reserved_for, expected_on${sex ? ", carer_sex" : ""}) values ('unit-${unit}', '${kid}', 'x', ${TODAY}${sex ? `, '${sex}'` : ""})`;
  await scenario(ids, "a hold needs the carer's sex", "social_worker", null, q(holdSql("B1", KID_A, null)), refused("carer's sex"));
  await scenario(ids, "a hold follows the room rule", "social_worker", placed(KID_A, "B1", MOM_A), q(holdSql("B2", KID_D, "M")), refused("women's room"));
  await scenario(ids, "a hold follows the room order", "social_worker", null, q(holdSql("B5", KID_A, "F")), refused("Room 1 still has a free bed"));
  await scenario(ids, "a held bed counts: a man cannot be put next to a woman's hold", "social_worker",
    () => client.query(holdSql("B1", KID_A, "F")), q(checkIn(KID_D, "B2", DAD_D)), refused("women's room"));
  await scenario(ids, "replacing a hold takes the new carer's sex", "social_worker",
    () => client.query(holdSql("B1", KID_A, "F")),
    q(`select ops.replace_bed_reservation((select id from ops.bed_reservations where patient_id = '${KID_A}' and status = 'active'), '${KID_B}', null, 'Rule B', 'F')`), ok);
  await scenario(ids, "house staff cannot check anyone in", "house_staff", null, q(checkIn(KID_A, "B1", MOM_A)), denied);
  await scenario(ids, "the rule helpers are not callable from the app", "social_worker", null,
    q(`select ops.bed_rule_problem('unit-B1', 'F', null, null, null)`), denied);
  await scenario(ids, "admins can allow exceptions (checked by the app)", "admin", null, q("select ops.can_allow_bed_exception() as yes"), (r) => r.ok && r.data[0].yes === true);
  await scenario(ids, "social workers cannot", "social_worker", null, q("select ops.can_allow_bed_exception() as yes"), (r) => r.ok && r.data[0].yes === false);

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
