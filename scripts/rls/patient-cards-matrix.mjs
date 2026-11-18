// Proves 0164 (Patient ID cards: issue, replace, switch off; who reads them) against the database,
// one scenario per transaction, every transaction rolled back. Same harness as bed-rules-matrix.mjs.
//
// Usage:      RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/patient-cards-matrix.mjs
// Pre-flight: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/patient-cards-matrix.mjs supabase/migrations/0164_patient_cards.sql
import { pgUrl } from "../lib/db-url.mjs";
import { Client } from "pg";
import { readFile } from "node:fs/promises";

if (process.env.RLS_ALLOW_PROD !== "1") {
  console.error("This targets the database named in the env file (rolled back per scenario). Set RLS_ALLOW_PROD=1 to run.");
  process.exit(1);
}
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD.");
  process.exit(1);
}
const client = new Client({ connectionString: pgUrl(password) });

const ROLES = ["admin", "social_worker", "house_staff", "ceo", "driver"];
const results = [];
const record = (name, verdict, detail = "") => results.push({ scenario: name, result: verdict, detail: String(detail).replace(/\s+/g, " ").slice(0, 90) });

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
  // A role with no account of its own borrows a test account (its role is rewritten inside the rolled-back scenario).
  const { rows: spare } = await client.query(`select id from shared.staff where staff_code like 'RLSTEST-%' and role not in ('admin') order by created_at limit 1`);
  for (const role of ROLES) if (!ids[role] && spare[0]) ids[role] = spare[0].id;
  return ids;
}
const claims = (id) => JSON.stringify({ sub: id, role: "authenticated" });
const PREFLIGHT = process.argv.slice(2);

const KID = "00000000-0000-4000-8000-0000000016a1";
const OTHER = "00000000-0000-4000-8000-0000000016a2";
const seed = () =>
  client.query(
    `insert into ops.patients (id, first_name, last_name, sex, status, admitted_at) values
       ('${KID}', 'Card', 'Child', 'F', 'ongoing', current_date),
       ('${OTHER}', 'Card', 'Other', 'M', 'ongoing', current_date)`
  );

async function scenario(ids, name, actor, setup, body, expect) {
  if (actor && !ids[actor]) return record(name, "SKIP", `no ${actor} account`);
  await client.query(PREFLIGHT.length ? "savepoint scenario" : "begin");
  try {
    if (actor) await client.query("update shared.staff set active = true, role = $2 where id = $1", [ids[actor], actor]);
    await seed();
    // Setup issues cards as the admin (the functions need a signed-in editor).
    if (ids.admin) {
      await client.query("update shared.staff set active = true where id = $1", [ids.admin]);
      await client.query("select set_config('request.jwt.claims', $1, true)", [claims(ids.admin)]);
    }
    if (setup) await setup();
    await client.query(actor ? "set local role authenticated" : "set local role anon");
    if (actor) await client.query("select set_config('request.jwt.claims', $1, true)", [claims(ids[actor])]);
    else await client.query("select set_config('request.jwt.claims', '', true)");
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
const q = (sql) => () => client.query(sql);
const steps = (...sqls) => async () => {
  let r;
  for (const s of sqls) r = await client.query(s);
  return r;
};
const issue = (kid, reason) => `select * from ops.issue_patient_card('${kid}'${reason ? `, '${reason}'` : ""})`;
const issued = (kid) => () => client.query(issue(kid));
const cardsOf = (kid) =>
  `select count(*)::int as n, count(*) filter (where status = 'active')::int as active, max(version) as v,
          (select status || ':' || coalesce(ended_reason, '') from ops.patient_cards where patient_id = '${kid}' and version = 1) as first
     from ops.patient_cards where patient_id = '${kid}'`;

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

  await scenario(ids, "a social worker issues card 1: active, a 32-character random code", "social_worker", null,
    q(issue(KID)), (r) => r.ok && r.data[0].version === 1 && r.data[0].status === "active" && /^[0-9a-f]{32}$/.test(r.data[0].token));
  await scenario(ids, "a new card replaces the old one, with the reason kept", "social_worker", issued(KID),
    steps(issue(KID, "Lost at NCH"), cardsOf(KID)), (r) => r.ok && r.data[0].n === 2 && r.data[0].active === 1 && r.data[0].v === 2 && r.data[0].first === "replaced:Lost at NCH");
  await scenario(ids, "two cards never share a code", "social_worker", async () => { await issued(KID)(); await issued(OTHER)(); },
    q("select count(distinct token)::int as d, count(*)::int as n from ops.patient_cards where patient_id in ('" + KID + "', '" + OTHER + "')"),
    (r) => r.ok && r.data[0].d === 2 && r.data[0].n === 2);
  await scenario(ids, "switching a card off needs a reason", "social_worker", issued(KID),
    q(`select * from ops.switch_off_patient_card((select id from ops.patient_cards where patient_id = '${KID}'), ' ')`), (r) => !r.ok && r.code === "22023");
  await scenario(ids, "switched off: no active card is left", "social_worker", issued(KID),
    steps(`select * from ops.switch_off_patient_card((select id from ops.patient_cards where patient_id = '${KID}'), 'Family left')`, cardsOf(KID)),
    (r) => r.ok && r.data[0].active === 0 && r.data[0].first === "switched_off:Family left");
  await scenario(ids, "a card already ended cannot be switched off again", "social_worker",
    async () => { await issued(KID)(); await client.query(issue(KID)); },
    q(`select * from ops.switch_off_patient_card((select id from ops.patient_cards where patient_id = '${KID}' and version = 1), 'x')`), (r) => !r.ok && r.code === "P0002");
  await scenario(ids, "a card for nobody is refused", "social_worker", null, q(issue("00000000-0000-4000-8000-000000000000")), (r) => !r.ok && r.code === "P0002");
  await scenario(ids, "house staff (no Patients access) cannot issue", "house_staff", null, q(issue(KID)), denied);
  await scenario(ids, "...nor read the cards", "house_staff", issued(KID), q(`select count(*)::int as n from ops.patient_cards where patient_id = '${KID}'`), (r) => r.ok && r.data[0].n === 0);
  await scenario(ids, "the CEO (Patients view) reads the cards", "ceo", issued(KID), q(`select count(*)::int as n from ops.patient_cards where patient_id = '${KID}'`), (r) => r.ok && r.data[0].n === 1);
  await scenario(ids, "...but cannot issue one", "ceo", null, q(issue(KID)), denied);
  await scenario(ids, "nobody writes the table directly", "admin", null,
    q(`insert into ops.patient_cards (patient_id, token, version) values ('${KID}', replace(gen_random_uuid()::text, '-', ''), 1)`), denied);
  await scenario(ids, "nobody edits a card directly", "admin", issued(KID), q(`update ops.patient_cards set status = 'replaced', ended_at = now() where patient_id = '${KID}'`), denied);
  await scenario(ids, "without a sign-in nothing is readable", null, issued(KID), q("select count(*) from ops.patient_cards"), denied);
  await scenario(ids, "without a sign-in no card can be issued", null, null, q(issue(KID)), denied);

  // ---- phase 2: scanning (0165) ----
  const has0165 = (await client.query("select to_regprocedure('ops.scan_card(text)') is not null as y")).rows[0].y;
  if (has0165) {
    const TODAY = "(now() at time zone 'Asia/Manila')::date";
    // The code comes from the QR, not from the table: setup (as postgres) keeps it in a setting the scanning role reads.
    const tokenOf = () => "current_setting('test.card_token')";
    const keepToken = (kid, status = "active") => client.query(`select set_config('test.card_token', (select token from ops.patient_cards where patient_id = '${kid}' and status = '${status}' order by version limit 1), true)`);
    const scan = (kid) => `select ops.scan_card(${tokenOf(kid)}) as s`;
    const meal = (kid, m) => `select ops.record_meal_by_card(${tokenOf(kid)}, '${m}') as r`;
    // An empty house (live families never decide a result), meals switched to the app, KID in bed B1 tonight.
    const emptyHouse = async () => {
      await client.query(`update ops.stays set status = 'checked_out', check_out_at = ${TODAY} where status in ('in_house', 'overdue')`);
      await client.query("update ops.bed_reservations set status = 'released', closed_at = now() where status = 'active'");
      await client.query(`delete from ops.bed_nights where night = ${TODAY}`);
      await client.query("update ops.units set status = 'available', lock_reason = null where active");
      await client.query("update ops.units set active = false where temporary and active");
    };
    const mealsInApp = () => client.query(`update shared.app_settings set programs_from_app_since = ${TODAY} - 1 where id`);
    const inHouse = async () => {
      await emptyHouse();
      await client.query(`insert into ops.stays (patient_id, bed_position_id, check_in_at, status) values ('${KID}', 'unit-B1-A', ${TODAY}, 'in_house')`);
    };
    // Last night in B1, closed by this morning's reset: tonight continues the visit.
    const continuing = async () => {
      await emptyHouse();
      await client.query(
        `insert into ops.stays (id, patient_id, bed_position_id, check_in_at, check_out_at, check_out_reason, status, visit_id)
         values ('00000000-0000-4000-8000-0000000016b1', '${KID}', 'unit-B1-A', ${TODAY} - 1, ${TODAY}, 'daily_reset', 'checked_out', '00000000-0000-4000-8000-0000000016b1')`
      );
    };
    const withCard = (more) => async () => { await issued(KID)(); await keepToken(KID); if (more) await more(); };

    await scenario(ids, "0165: a social worker's scan shows the child, the case number and the bed", "social_worker", withCard(inHouse), q(scan(KID)),
      (r) => r.ok && r.data[0].s.status === "active" && r.data[0].s.name === "Card Child" && r.data[0].s.bed === "B1" && r.data[0].s.patientId === KID && r.data[0].s.canAdmit === true);
    await scenario(ids, "0165: house staff see only what a meal needs", "house_staff", withCard(inHouse), q(scan(KID)),
      (r) => r.ok && r.data[0].s.name === "Card Child" && r.data[0].s.canMeal === true && r.data[0].s.canAdmit === false && r.data[0].s.caseNumber === null && r.data[0].s.bed === null && r.data[0].s.patientId === null);
    await scenario(ids, "0165: every scan is logged", "social_worker", withCard(inHouse),
      steps(scan(KID), `select count(*)::int as n from ops.card_scans where patient_id = '${KID}' and purpose = 'look'`), (r) => r.ok && r.data[0].n === 1);
    await scenario(ids, "0165: an unknown or malformed code shows nothing", "social_worker", null,
      q("select ops.scan_card('0123456789abcdef0123456789abcdef') as a, ops.scan_card('LFCN-2026-0001') as b"),
      (r) => r.ok && r.data[0].a.status === "unknown" && r.data[0].b.status === "unknown");
    await scenario(ids, "0165: a replaced card says so and names the newer card", "social_worker",
      async () => { await issued(KID)(); await keepToken(KID); await client.query(issue(KID, "Lost")); },
      q(scan(KID)), (r) => r.ok && r.data[0].s.status === "replaced" && r.data[0].s.newerVersion === 2);
    // 0166 lets drivers scan and records meals whatever the Programs sheet does.
    const has0166 = (await client.query("select to_regprocedure('ops.add_passenger_by_card(text,uuid,smallint)') is not null as y")).rows[0].y;
    await scenario(ids, "0165: a role that neither sees Patients nor edits House Ops (or Transport) cannot scan", "admin",
      async () => { await issued(KID)(); await keepToken(KID); await client.query("update shared.staff set role = $2 where id = $1", [ids.admin, has0166 ? "volunteer" : "driver"]); }, q(scan(KID)), denied);
    if (!has0166) {
      await scenario(ids, "0165: no meal by scan while meals are on the Programs sheet", "social_worker", withCard(inHouse), q(meal(KID, "lunch")), (r) => !r.ok && r.code === "23514" && r.msg.includes("Programs sheet"));
    } else {
      await scenario(ids, "0166: a meal is recorded while the Programs sheet is still read", "social_worker", withCard(inHouse), q(meal(KID, "lunch")), (r) => r.ok && r.data[0].r.added === true);
    }
    await scenario(ids, "0165: house staff record a meal by scan, logged; a second scan adds nothing", "house_staff",
      withCard(async () => { await inHouse(); await mealsInApp(); }),
      steps(meal(KID, "lunch"), meal(KID, "lunch"),
        `select (select count(*)::int from ops.meals_served where patient_id = '${KID}' and date = ${TODAY}) as meals,
                (select count(*)::int from ops.card_scans where patient_id = '${KID}' and purpose = 'meal') as logged,
                (select served_by = auth.uid() from ops.meals_served where patient_id = '${KID}' and date = ${TODAY}) as mine`),
      (r) => r.ok && r.data[0].meals === 1 && r.data[0].mine === true);
    await scenario(ids, "0165: ...both scans are in the log (read by Patients viewers)", "social_worker",
      withCard(async () => { await inHouse(); await mealsInApp(); }),
      steps(meal(KID, "dinner"), meal(KID, "dinner"), `select count(*)::int as logged from ops.card_scans where patient_id = '${KID}' and purpose = 'meal'`),
      (r) => r.ok && r.data[0].logged === 2);
    await scenario(ids, "0165: no meal for a child not staying at the house", "social_worker",
      withCard(async () => { await emptyHouse(); await mealsInApp(); }), q(meal(KID, "dinner")), (r) => !r.ok && r.code === "23514");
    await scenario(ids, "0165: breakfast is fine for last night's family before tonight's bed", "social_worker",
      withCard(async () => { await continuing(); await mealsInApp(); }), q(meal(KID, "breakfast")), (r) => r.ok && r.data[0].r.added === true);
    await scenario(ids, "0165: same bed as last night by scan, logged", "social_worker", withCard(continuing),
      steps(`select ops.readmit_by_card(${tokenOf(KID)})`,
        `select (select count(*)::int from ops.stays where patient_id = '${KID}' and status = 'in_house') as tonight,
                (select count(*)::int from ops.card_scans where patient_id = '${KID}' and purpose = 'admission') as logged`),
      (r) => r.ok && r.data[0].tonight === 1 && r.data[0].logged === 1);
    await scenario(ids, "0165: house staff cannot admit by scan", "house_staff", withCard(continuing), q(`select ops.readmit_by_card(${tokenOf(KID)})`), denied);
    await scenario(ids, "0165: no photo without consent", "social_worker", withCard(inHouse), q(`select ops.card_photo_path(${tokenOf(KID)}) as p`), (r) => r.ok && r.data[0].p === null);
    await scenario(ids, "0165: without a sign-in a scan shows nothing", null, withCard(), q(scan(KID)), denied);

    // ---- 0166: Housing, Meals (any day the settings allow), Transport ----
    if (has0166) {
      const mealOn = (m, day) => `select ops.record_meal_by_card(${tokenOf()}, '${m}', ${day}) as r`;
      // KID stayed the last 5 nights (one stay per night), the last one closed by this morning's reset.
      const stayedDays = async () => {
        await emptyHouse();
        for (let n = 5; n >= 1; n--) {
          await client.query(`insert into ops.stays (patient_id, bed_position_id, check_in_at, check_out_at, check_out_reason, status)
                              values ('${KID}', 'unit-B1-A', ${TODAY} - ${n}, ${TODAY} - ${n - 1}, 'daily_reset', 'checked_out')`);
        }
      };
      const TRIP = "00000000-0000-4000-8000-0000000016c1";
      const OTHER_TRIP = "00000000-0000-4000-8000-0000000016c2";
      // Today's open pick-up from NCH, driven by the driver account; another trip driven by someone else.
      const trips = async () => {
        await client.query(`insert into ops.trips (id, date, direction, driver_staff_id, status, carries_passengers, vehicle, departure_time) values
          ('${TRIP}', ${TODAY}, 'from_hospital', $1, 'scheduled', true, 'Matrix van', '09:00'),
          ('${OTHER_TRIP}', ${TODAY}, 'to_hospital', $2, 'in_progress', true, 'Matrix van', '10:00')`, [ids.driver, ids.admin]);
      };
      const board = (trip, people = 2) => `select ops.add_passenger_by_card(${tokenOf()}, '${trip}', ${people}::smallint) as r`;

      await scenario(ids, "0166: a meal 4 days back is fine (the family stayed)", "social_worker", withCard(stayedDays), q(mealOn("dinner", `${TODAY} - 4`)), (r) => r.ok && r.data[0].r.added === true);
      await scenario(ids, "0166: no meal for a day to come", "social_worker", withCard(inHouse), q(mealOn("lunch", `${TODAY} + 1`)), (r) => !r.ok && r.code === "22023");
      await scenario(ids, "0166: no meal further back than Settings allow", "social_worker",
        withCard(async () => { await stayedDays(); await client.query("update shared.app_settings set meals_back_days = 2 where id"); }),
        q(mealOn("dinner", `${TODAY} - 4`)), denied);
      await scenario(ids, "0166: no meal for a day the family was not staying", "social_worker", withCard(stayedDays), q(mealOn("lunch", `${TODAY} - 20`)), (r) => !r.ok && r.code === "23514");
      await scenario(ids, "0166: the meal days are 0 to 365", "admin", null, q("update shared.app_settings set meals_back_days = 400 where id"), (r) => !r.ok && r.code === "23514");
      await scenario(ids, "0166: a driver's scan shows only their own open trip, and no case number", "driver", withCard(async () => { await inHouse(); await trips(); }), q(scan(KID)),
        (r) => r.ok && r.data[0].s.canTransport === true && r.data[0].s.canMeal === false && r.data[0].s.caseNumber === null && r.data[0].s.trips.length === 1 && r.data[0].s.trips[0].id === TRIP);
      await scenario(ids, "0166: the driver adds the child to their trip", "driver", withCard(async () => { await inHouse(); await trips(); }),
        steps(board(TRIP, 3), `select people from ops.trip_passengers where trip_id = '${TRIP}' and patient_id = '${KID}'`), (r) => r.ok && r.data[0]?.people === 3);
      await scenario(ids, "0166: ...not to a trip someone else drives", "driver", withCard(async () => { await inHouse(); await trips(); }), q(board(OTHER_TRIP)), denied);
      // Owner, 19 Nov 2026: a driver is not allowed to tick meals, by scan either.
      await scenario(ids, "0166: a driver cannot record a meal by scan", "driver", withCard(inHouse), q(mealOn("lunch", TODAY)), denied);
      await scenario(ids, "0166: a social worker picks any open trip today", "social_worker", withCard(async () => { await inHouse(); await trips(); }),
        steps(board(OTHER_TRIP), `select count(*)::int as n from ops.card_scans where patient_id = '${KID}' and purpose = 'transport'`), (r) => r.ok && r.data[0].n === 1);
      await scenario(ids, "0166: a trip already completed takes nobody", "social_worker",
        withCard(async () => { await inHouse(); await trips(); await client.query(`update ops.trips set status = 'completed' where id = '${TRIP}'`); }), q(board(TRIP)), (r) => !r.ok && r.code === "23514");
      await scenario(ids, "0166: house staff add no passengers", "house_staff", withCard(async () => { await inHouse(); await trips(); }), q(board(TRIP)), denied);
      await scenario(ids, "0166: another bed tonight by scan follows the bed rules", "social_worker", withCard(continuing),
        q(`select ops.readmit_by_card(${tokenOf()}, 'unit-B5')`), (r) => !r.ok && r.code === "23514" && r.msg.includes("Room 1 still has a free bed"));
      await scenario(ids, "0166: a check-in after a scan is logged; house staff cannot log one", "house_staff", withCard(), q(`select ops.log_card_scan(${tokenOf()}, 'admission', 'checked in')`), denied);
    }
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
