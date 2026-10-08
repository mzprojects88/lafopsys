// Proves 0082 (a donor's totals follow their donations; history can't be deleted with the donor)
// and who may edit donor details, against the live database: one scenario per transaction, every
// one rolled back. Same harness as scripts/rls/correction-request-matrix.mjs.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/donor-totals-matrix.mjs
// Pre-flight: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/donor-totals-matrix.mjs supabase/migrations/0082_donor_totals_follow_donations.sql
import { pgUrl } from "../lib/db-url.mjs";
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
const client = new Client({ connectionString: pgUrl(password) });

const ROLES = ["admin", "finance", "office_admin", "inventory_staff", "chef"];
const results = [];
const record = (name, verdict, detail = "") =>
  results.push({ scenario: name, result: verdict, detail: String(detail).replace(/\s+/g, " ").slice(0, 80) });

// A role with no account of its own borrows a test account, whose role is rewritten for the
// duration of its rolled-back transaction.
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

async function scenario(ids, name, actor, body, expect) {
  if (actor && !ids[actor]) {
    record(name, "SKIP", `no ${actor} account`);
    return;
  }
  await client.query(PREFLIGHT.length ? "savepoint scenario" : "begin");
  try {
    if (actor) await client.query("update shared.staff set active = true, role = $2, extra_roles = '{}' where id = $1", [ids[actor], actor]);
    await seed();
    await client.query("set local role authenticated");
    if (actor) await client.query("select set_config('request.jwt.claims', $1, true)", [claims(ids[actor])]);
    // A plan cached as postgres must not answer for authenticated (feedback: discard plans).
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

const denied = (r) => !r.ok && r.code === "42501";
const rows = (n) => (r) => r.ok && r.rows === n;
const totals = (n, v, first, last) => (r) =>
  r.ok && r.rows === 1 && r.data[0].gift_count === n && Number(r.data[0].lifetime_value) === v && r.data[0].first === first && r.data[0].last === last;

const PREFLIGHT = process.argv.slice(2);
const D1 = "00000000-0000-4000-8000-0000000d0001";
const D2 = "00000000-0000-4000-8000-0000000d0002";
const D3 = "00000000-0000-4000-8000-0000000d0003";
const G1 = "00000000-0000-4000-8000-0000000d00a1";
const G2 = "00000000-0000-4000-8000-0000000d00a2";

// As postgres, inside each scenario's transaction: two donors with history, one without.
async function seed() {
  await client.query(
    `insert into ops.donors (id, name, type, tax_jurisdiction) values
     ($1, 'RLSTEST Donor One', 'individual', 'PH'), ($2, 'RLSTEST Donor Two', 'corporate', 'PH'), ($3, 'RLSTEST Donor Three', 'individual', 'PH')`,
    [D1, D2, D3]
  );
  await client.query(
    `insert into ops.donations (id, donor_id, date, receiving_entity, kind, total_value, currency, status) values
     ($1, $3, '2026-09-01', 'PH_SEC', 'in_kind', 100, 'PHP', 'finalized'),
     ($2, $3, '2026-10-01', 'PH_SEC', 'in_kind', 50, 'PHP', 'pending_review')`,
    [G1, G2, D1]
  );
}
const read = (id) => `select gift_count, lifetime_value, to_char(first_gift_date, 'YYYY-MM-DD') as first, to_char(last_gift_date, 'YYYY-MM-DD') as last from ops.donors where id = '${id}'`;
const then = (...sqls) => async () => {
  let r;
  for (const sql of sqls) r = await client.query(sql);
  return r;
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

  // ---- totals follow the donations ----
  await scenario(ids, "a donor's totals come from their donations (pending included)", "finance", () => client.query(read(D1)), totals(2, 150, "2026-09-01", "2026-10-01"));
  await scenario(ids, "a donation logged by inventory staff updates the donor", "inventory_staff",
    then(`insert into ops.donations (donor_id, date, receiving_entity, kind, total_value, currency, status) values ('${D1}', '2026-10-07', 'PH_SEC', 'in_kind', 25, 'PHP', 'pending_review')`, read(D1)),
    totals(3, 175, "2026-09-01", "2026-10-07"));
  await scenario(ids, "a wrong total can't be written, even by an editor", "finance",
    then(`update ops.donors set lifetime_value = 999999, gift_count = 99, last_gift_date = '2030-01-01' where id = '${D1}'`, read(D1)),
    totals(2, 150, "2026-09-01", "2026-10-01"));
  await scenario(ids, "a new donor starts at zero whatever is sent", "admin",
    then(`insert into ops.donors (id, name, type, tax_jurisdiction, lifetime_value, gift_count) values ('00000000-0000-4000-8000-0000000d0009', 'RLSTEST New', 'individual', 'PH', 5000, 9)`, read("00000000-0000-4000-8000-0000000d0009")),
    totals(0, 0, null, null));
  await scenario(ids, "removing a donation updates the donor", "admin", then(`delete from ops.donations where id = '${G2}'`, read(D1)), totals(1, 100, "2026-09-01", "2026-09-01"));
  await scenario(ids, "moving a donation to another donor updates both", "admin",
    then(`update ops.donations set donor_id = '${D2}' where id = '${G2}'`, `select (select gift_count from ops.donors where id = '${D1}') = 1 and (select gift_count from ops.donors where id = '${D2}') = 1 and (select lifetime_value from ops.donors where id = '${D2}') = 50 as ok`),
    (r) => r.ok && r.data[0].ok === true);
  await scenario(ids, "changing a donation's value updates the donor", "finance", then(`update ops.donations set total_value = 80 where id = '${G2}'`, read(D1)), totals(2, 180, "2026-09-01", "2026-10-01"));

  // ---- history stays ----
  await scenario(ids, "a donor with donations can't be deleted", "admin", () => client.query(`delete from ops.donors where id = '${D1}'`), (r) => !r.ok && r.code === "23503");
  await scenario(ids, "a donor without history can be deleted", "admin", () => client.query(`delete from ops.donors where id = '${D3}'`), rows(1));
  await scenario(ids, "nobody calls the totals helper directly", "finance", () => client.query(`select * from ops.donor_totals('${D1}')`), denied);

  // ---- who edits donor details ----
  await scenario(ids, "finance edits a donor's details", "finance", () => client.query(`update ops.donors set email = 'x@example.org', tin = '123-456-789-000' where id = '${D1}'`), rows(1));
  await scenario(ids, "the office admin edits a donor's details", "office_admin", () => client.query(`update ops.donors set phone = '09170000000' where id = '${D1}'`), rows(1));
  await scenario(ids, "inventory staff can't edit a donor's details", "inventory_staff", () => client.query(`update ops.donors set name = 'Changed' where id = '${D1}'`), rows(0));
  await scenario(ids, "the chef can't edit a donor's details", "chef", () => client.query(`update ops.donors set name = 'Changed' where id = '${D1}'`), rows(0));
  await scenario(ids, "finance adds a donor", "finance", () => client.query(`insert into ops.donors (name, type, tax_jurisdiction) values ('RLSTEST Added', 'individual', 'PH')`), rows(1));
  await scenario(ids, "no session sees no donors", null, () => client.query(`select id from ops.donors where id = '${D1}'`), (r) => (r.ok && r.rows === 0) || denied(r));

  // ---- 0083: clean-up suggestions and merging ----
  const has0083 = (await client.query("select to_regclass('ops.donor_suggestions') is not null as ok")).rows[0].ok;
  if (has0083) {
    const receipt = `insert into inventory.donation_log (id, donor_id, date, valuation_total, item_summary) values ('T-MERGE-RCPT', '${D2}', '2026-10-01', 10, '1 pc test')`;
    await scenario(ids, "finance merges a duplicate: gifts and inventory receipts move, the merge is logged", "finance",
      then(`select set_config('x.r', '', true)`,
        // the receipt is added as postgres inside the same transaction before the role switch would be ideal; here finance cannot insert it, so merge only gifts
        `update ops.donations set donor_id = '${D2}' where id = '${G2}'`,
        `select ops.merge_donors('${D1}', '${D2}', 'Same donor typed twice')`,
        `select (select count(*) from ops.donors where id = '${D2}') = 0
            and (select gift_count from ops.donors where id = '${D1}') = 2
            and (select count(*) from ops.donor_merges where kept_id = '${D1}' and dropped_id = '${D2}') = 1 as ok`),
      (r) => r.ok && r.data[0].ok === true);
    await scenario(ids, "a merge moves the donor's LAF Inventory receipts too", "admin",
      async () => {
        await client.query("reset role");
        await client.query(receipt);
        await client.query("set local role authenticated");
        await client.query("discard plans");
        await client.query(`select ops.merge_donors('${D1}', '${D2}', 'Same donor')`);
        return client.query(`select donor_id = '${D1}' as ok from inventory.donation_log where id = 'T-MERGE-RCPT'`);
      },
      (r) => r.ok && r.data[0]?.ok === true);
    await scenario(ids, "a merge needs a reason", "finance", () => client.query(`select ops.merge_donors('${D1}', '${D2}', '')`), (r) => !r.ok && r.code === "22023");
    await scenario(ids, "inventory staff can't merge donors", "inventory_staff", () => client.query(`select ops.merge_donors('${D1}', '${D2}', 'Same donor')`), denied);
    await scenario(ids, "an editor adds a suggestion", "office_admin",
      () => client.query(`insert into ops.donor_suggestions (donor_id, kind, proposed, reason, source) values ('${D1}', 'format', '{"name":"Rlstest Donor One"}', 'Capitals', 'rule')`), rows(1));
    await scenario(ids, "the chef can't add a suggestion", "chef",
      () => client.query(`insert into ops.donor_suggestions (donor_id, kind, proposed, source) values ('${D1}', 'format', '{}', 'rule')`), denied);
    await scenario(ids, "nobody adds a suggestion already marked applied", "finance",
      () => client.query(`insert into ops.donor_suggestions (donor_id, kind, proposed, source, status) values ('${D1}', 'format', '{}', 'rule', 'applied')`), denied);
    const suggested = async (sql) => {
      await client.query("reset role");
      await client.query(`insert into ops.donor_suggestions (id, donor_id, kind, proposed, reason, source) values ('00000000-0000-4000-8000-0000000d0e01', '${D1}', 'format', '{"name":"Rlstest Donor One","salutation":"Ms.","type":"individual"}', 'Capitals', 'rule')`);
      await client.query("set local role authenticated");
      await client.query("discard plans");
      return client.query(sql);
    };
    const S1 = "'00000000-0000-4000-8000-0000000d0e01'";
    await scenario(ids, "an editor applies a suggestion, edited first", "finance",
      async () => {
        await suggested(`select ops.apply_donor_suggestion(${S1}, 'Rlstest Donor Uno', null, null)`);
        return client.query(`select (select name from ops.donors where id = '${D1}') = 'Rlstest Donor Uno' and (select salutation from ops.donors where id = '${D1}') = 'Ms.' and (select status from ops.donor_suggestions where id = ${S1}) = 'applied' as ok`);
      },
      (r) => r.ok && r.data?.[0]?.ok === true);
    await scenario(ids, "an editor rejects a suggestion; it can't be decided twice", "finance",
      () => suggested(`select ops.reject_donor_suggestion(${S1}, 'Name is right'); select ops.apply_donor_suggestion(${S1})`), (r) => !r.ok && r.code === "22023");
    await scenario(ids, "the chef can't apply a suggestion", "chef", () => suggested(`select ops.apply_donor_suggestion(${S1})`), denied);
    await scenario(ids, "nobody changes a suggestion directly", "finance", () => suggested(`update ops.donor_suggestions set status = 'applied' where id = ${S1}`), denied);
  } else {
    record("0083 scenarios", "SKIP", "0083 not applied (pass it as a pre-flight file)");
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
