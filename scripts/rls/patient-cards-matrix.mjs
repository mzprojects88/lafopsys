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

const ROLES = ["admin", "social_worker", "house_staff", "ceo"];
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
