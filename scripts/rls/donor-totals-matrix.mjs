// Proves 0082 (a donor's totals follow their donations; history can't be deleted with the donor)
// and who may edit donor details, against the live database: one scenario per transaction, every
// one rolled back. Same harness as scripts/rls/correction-request-matrix.mjs.
//
// Usage: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/donor-totals-matrix.mjs
// Pre-flight: RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/donor-totals-matrix.mjs supabase/migrations/0082_donor_totals_follow_donations.sql
//   (a migration that alters ops.donations keeps it locked for the whole pre-flight: rehearse the
//   full matrix on a copy, and on the live tables run a few scenarios only, MATRIX_ONLY="regex")
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
  // MATRIX_ONLY=<regex> runs just the matching scenarios: a pre-flight on the live tables holds
  // the migration's locks for as long as it runs, so keep that run to a few scenarios.
  if (process.env.MATRIX_ONLY && !new RegExp(process.env.MATRIX_ONLY, "i").test(name)) return;
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
  // A pre-flight holds the migration's table locks until it ends: never wait long for a lock, and
  // let the server end the transaction if this script dies or loses its connection.
  await client.query("set lock_timeout = '5s'; set idle_in_transaction_session_timeout = '120s'");
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

  // ---- 0084: cash gifts from accounting's sheets ----
  const has0084 = (await client.query("select to_regclass('ops.cash_gift_lines') is not null as ok")).rows[0].ok;
  if (has0084) {
    const L = (row, name, amount, more = {}) => ({ sheet_row: row, date: "2024-03-01", donor_name: name, kind: "cash", payment_method: "check", amount, invoice_number: `T${row}`, notes: null, ...more });
    const FIRST = [L(2, "RLSTEST DONOR ONE", 500), L(3, "Rlstest Newgiver", 250), L(4, "Rlstest Newgiver", 250)];
    // As the server (postgres here): the sheet is read. Real 2024 lines, if any, are set aside first
    // so the half-or-more guard judges only these (all rolled back).
    const received = async (lines, sql) => {
      await client.query("reset role");
      await client.query("delete from ops.cash_gift_lines where source = '2024'; delete from ops.cash_gift_sources where source = '2024'");
      const r = await client.query("select ops.receive_cash_lines('2024', $1::jsonb) as r", [JSON.stringify(lines)]);
      await client.query("set local role authenticated");
      await client.query("discard plans");
      return sql ? client.query(sql) : r;
    };
    const again = async (lines) => {
      await client.query("reset role");
      const r = await client.query("select ops.receive_cash_lines('2024', $1::jsonb) as r", [JSON.stringify(lines)]);
      await client.query("set local role authenticated");
      await client.query("discard plans");
      return r;
    };
    const decide = (d) => client.query("select ops.decide_sheet_names($1::jsonb) as posted", [JSON.stringify(d)]);
    const K1 = "donor one rlstest";
    const KN = "newgiver rlstest";
    const sheetGifts = (donor) => `select count(*)::int as n from ops.donations where source_id like 'sheet:2024:%' and donor_id = '${donor}'`;
    const giftsAre = (donor, n, v) => `(select count(*) = ${n} and coalesce(sum(total_value), 0) = ${v} from ops.donations where source_id like 'sheet:2024:%' and donor_id = '${donor}')`;

    await scenario(ids, "the name key is the app's (same pairs as tests/cash-gifts.test.mjs)", "finance",
      () => client.query(`select ops.donor_name_key('Ms. María  Santos-Cruz') = 'cruz maria santos' and ops.donor_name_key('Jessa C. Calma') = 'calma jessa'
        and ops.donor_name_key('SAMPLE FOOD CORP.') = 'corp food sample' and ops.donor_name_key('Carlo/Joy De Jesus') = 'carlo de jesus joy'
        and ops.donor_name_key('3M Philippines, Inc.') = '3m inc philippines' and ops.donor_name_key('???') = 'unnamed' as ok`),
      (r) => r.ok && r.data[0].ok === true);
    await scenario(ids, "a read lands the lines; nothing joins the donor list until a name is confirmed", "finance",
      () => received(FIRST, `select (select count(*) from ops.cash_gift_lines where source = '2024') = 3 and (select count(*) from ops.donations where source_id like 'sheet:2024:%') = 0
        and (select count(distinct line_key) from ops.cash_gift_lines where source = '2024' and name_key = '${KN}') = 2 as ok`),
      (r) => r.ok && r.data[0].ok === true);
    await scenario(ids, "the chef doesn't see the cash lines", "chef", () => received(FIRST, "select 1 from ops.cash_gift_lines where source = '2024'"), (r) => (r.ok && r.rows === 0) || denied(r));
    await scenario(ids, "staff can't call the sheet reader themselves (the server does)", "finance", () => client.query("select ops.receive_cash_lines('2024', '[]'::jsonb)"), denied);
    await scenario(ids, "nobody writes lines or name decisions directly", "finance",
      () => client.query(`insert into ops.donor_sheet_names (name_key, sheet_name, donor_id) values ('x y', 'X Y', '${D1}')`), denied);
    await scenario(ids, "finance confirms a name as an existing donor: its gift posts and the totals follow", "finance",
      async () => {
        await received(FIRST);
        await decide([{ name_key: K1, donor_id: D1 }]);
        return client.query(`select (select gift_count from ops.donors where id = '${D1}') = 3 and (select lifetime_value from ops.donors where id = '${D1}') = 650
          and (select count(*) from ops.donations where donor_id = '${D1}' and kind = 'cash' and payment_method = 'check' and invoice_number = 'T2' and status = 'finalized' and total_value = 500) = 1 as ok`);
      },
      (r) => r.ok && r.data[0].ok === true);
    await scenario(ids, "the office admin confirms a name as a new donor: the donor is made, both gifts post", "office_admin",
      async () => {
        await received(FIRST);
        const r = await decide([{ name_key: KN, name: "  Rlstest   Newgiver ", salutation: "Ms.", type: "individual" }]);
        await decide([{ name_key: KN, name: "Rlstest Newgiver", salutation: null, type: "individual" }]); // a second click
        const q = await client.query(`select (select count(*) from ops.donors where name = 'Rlstest Newgiver' and salutation = 'Ms.' and gift_count = 2 and lifetime_value = 500) = 1 as ok`);
        return { ...q, rows: [{ ok: q.rows[0].ok && r.rows[0].posted === 2 }] };
      },
      (r) => r.ok && r.data[0].ok === true);
    await scenario(ids, "a name marked not a donor posts nothing", "finance",
      async () => {
        await received(FIRST);
        await decide([{ name_key: KN, skip: true }]);
        return client.query(`select (select count(*) from ops.donations where source_id like 'sheet:2024:%') = 0 and (select count(*) from ops.donor_sheet_names where name_key = '${KN}' and donor_id is null) = 1 as ok`);
      },
      (r) => r.ok && r.data[0].ok === true);
    await scenario(ids, "inventory staff can't confirm names", "inventory_staff", async () => { await received(FIRST); return decide([{ name_key: K1, donor_id: D1 }]); }, denied);
    await scenario(ids, "a name that isn't on the sheets can't be confirmed", "finance", async () => { await received(FIRST); return decide([{ name_key: "nobody here", donor_id: D1 }]); }, (r) => !r.ok && r.code === "22023");
    await scenario(ids, "a new donor needs a name and a type", "finance", async () => { await received(FIRST); return decide([{ name_key: KN, name: "R", type: "individual" }]); }, (r) => !r.ok && r.code === "22023");
    await scenario(ids, "the next read: a line gone from the sheet takes its gift away, a new line posts, an unchanged read changes nothing", "finance",
      async () => {
        await received(FIRST);
        await decide([{ name_key: K1, donor_id: D1 }, { name_key: KN, donor_id: D2 }]);
        const next = [L(2, "RLSTEST DONOR ONE", 500), L(3, "Rlstest Newgiver", 250), L(9, "Rlstest Donor One", 75)];
        const a = await again(next);
        const b = await again(next);
        const q = await client.query(`select ${giftsAre(D1, 2, 575)} and ${giftsAre(D2, 1, 250)} as ok`);
        return { ...q, rows: [{ ok: q.rows[0].ok && a.rows[0].r.status === "received" && b.rows[0].r.status === "unchanged" }] };
      },
      (r) => r.ok && r.data[0].ok === true);
    await scenario(ids, "a gift with a receipt issued stays even when its line leaves the sheet", "finance",
      async () => {
        await received(FIRST);
        await decide([{ name_key: K1, donor_id: D1 }]);
        await client.query(`insert into ops.acknowledgment_receipts (donation_id, sequence_number, entity) select id, 'RLSTEST-AR-1', 'PH_SEC' from ops.donations where source_id like 'sheet:2024:%' and donor_id = '${D1}'`);
        await again([L(3, "Rlstest Newgiver", 250), L(4, "Rlstest Newgiver", 250)]);
        return client.query(sheetGifts(D1));
      },
      (r) => r.ok && r.data[0].n === 1);
    await scenario(ids, "a read that lost more than half its lines is refused", "finance",
      async () => { await received(FIRST); return again([L(2, "RLSTEST DONOR ONE", 500)]); }, (r) => !r.ok && r.code === "22023");
    await scenario(ids, "a merge moves the merged donor's sheet names and cash gifts", "finance",
      async () => {
        await received(FIRST);
        await decide([{ name_key: KN, donor_id: D2 }]);
        await client.query(`select ops.merge_donors('${D1}', '${D2}', 'Same donor typed twice')`);
        await again([...FIRST, L(9, "Rlstest Newgiver", 40)]);
        return client.query(`select (select donor_id from ops.donor_sheet_names where name_key = '${KN}') = '${D1}' and ${giftsAre(D1, 3, 540)} as ok`);
      },
      (r) => r.ok && r.data[0].ok === true);
    await scenario(ids, "an editor keeps the AI's hint for a name; it is never rewritten", "office_admin",
      then(`insert into ops.sheet_name_hints (name_key, type, incomplete, note) values ('eagles', 'foundation', false, 'A club')`,
        `insert into ops.sheet_name_hints (name_key, type) values ('eagles', 'corporate') on conflict (name_key) do nothing`,
        `select type = 'foundation' and created_by is not null as ok from ops.sheet_name_hints where name_key = 'eagles'`),
      (r) => r.ok && r.data[0]?.ok === true);
    await scenario(ids, "nobody changes or removes a hint", "finance",
      then(`insert into ops.sheet_name_hints (name_key, type) values ('eagles', 'foundation')`, `update ops.sheet_name_hints set type = 'corporate' where name_key = 'eagles'`), denied);
    await scenario(ids, "the chef can't add a hint", "chef", () => client.query(`insert into ops.sheet_name_hints (name_key, type) values ('eagles', 'foundation')`), denied);
    await scenario(ids, "inventory staff still log a gift in kind (what LAF Inventory sends)", "inventory_staff",
      () => client.query(`insert into ops.donations (donor_id, date, receiving_entity, kind, item_description, item_type, quantity, unit_value, total_value, currency, status, source_id) values ('${D1}', '2026-10-12', 'PH_SEC', 'in_kind', '2 sack Rice', 'FOOD', 2, 1300, 2600, 'PHP', 'pending_review', 'don-rlstest-1')`), rows(1));
    await scenario(ids, "the chef still logs a gift in kind", "chef",
      () => client.query(`insert into ops.donations (donor_id, date, receiving_entity, kind, total_value, currency, status) values ('${D1}', '2026-10-12', 'PH_SEC', 'in_kind', 10, 'PHP', 'pending_review')`), rows(1));
    await scenario(ids, "inventory staff can't record a cash gift", "inventory_staff",
      () => client.query(`insert into ops.donations (donor_id, date, receiving_entity, kind, total_value, currency, status) values ('${D1}', '2026-10-12', 'PH_SEC', 'cash', 10, 'PHP', 'finalized')`), denied);
    await scenario(ids, "an admin (receiving in LAF Inventory) still logs a gift in kind", "admin",
      () => client.query(`insert into ops.donations (donor_id, date, receiving_entity, kind, total_value, currency, status, source_id) values ('${D1}', '2026-10-12', 'PH_SEC', 'in_kind', 10, 'PHP', 'pending_review', 'don-rlstest-2')`), rows(1));
    await scenario(ids, "a payment method is only for cash", "finance",
      () => client.query(`insert into ops.donations (donor_id, date, receiving_entity, kind, total_value, currency, payment_method) values ('${D1}', '2026-10-01', 'PH_SEC', 'in_kind', 10, 'PHP', 'gcash')`), (r) => !r.ok && r.code === "23514");
    await scenario(ids, "finance records a cash gift by hand, with how it was paid", "finance",
      () => client.query(`insert into ops.donations (donor_id, date, receiving_entity, kind, total_value, currency, payment_method, invoice_number) values ('${D1}', '2026-10-01', 'PH_SEC', 'cash', 10, 'PHP', 'gcash', '0531')`), rows(1));
  } else {
    record("0084 scenarios", "SKIP", "0084 not applied (pass it as a pre-flight file)");
  }

  // ---- 0085: cash ARs and donee certificates numbered by the database ----
  const has0085 = (await client.query("select to_regclass('ops.doc_counters') is not null as ok")).rows[0].ok;
  if (has0085) {
    const C1 = "00000000-0000-4000-8000-0000000d00c1";
    const cashGift = `insert into ops.donations (id, donor_id, date, receiving_entity, kind, total_value, currency, payment_method, invoice_number) values ('${C1}', '${D1}', '2026-10-13', 'PH_SEC', 'cash', 1250.5, 'PHP', 'gcash', '0531')`;
    const isSeries = (prefix) => (r) => r.ok && new RegExp(`^${prefix}-\\d{4}-\\d{4}$`).test(r.data[0].n);
    const invalid = (r) => !r.ok && r.code === "22023";
    await scenario(ids, "finance issues a LAF-CSH receipt for a cash gift; it carries the booklet number", "finance",
      then(cashGift, `select ops.issue_cash_ar('${C1}') as n`, `select sequence_number as n from ops.acknowledgment_receipts where donation_id = '${C1}' and status = 'issued' and booklet_number = '0531' and amount = 1250.5 and issued_by = auth.uid()`),
      isSeries("LAF-CSH"));
    await scenario(ids, "a gift in kind is receipted in LAF Inventory, not here", "finance", () => client.query(`select ops.issue_cash_ar('${G1}')`), invalid);
    await scenario(ids, "a cash gift is receipted once", "finance", then(cashGift, `select ops.issue_cash_ar('${C1}')`, `select ops.issue_cash_ar('${C1}')`), invalid);
    await scenario(ids, "the chef can't issue a receipt", "chef", () => client.query(`select ops.issue_cash_ar('${G1}')`), denied);
    await scenario(ids, "inventory staff can't issue a receipt", "inventory_staff", () => client.query(`select ops.issue_cash_ar('${G1}')`), denied);
    await scenario(ids, "the browser can't write the receipt tables", "finance",
      () => client.query(`insert into ops.acknowledgment_receipts (donation_id, sequence_number, entity) values ('${G1}', 'AR-X', 'PH_SEC')`), denied);
    await scenario(ids, "nobody takes a number directly", "finance", () => client.query("select ops.next_doc_number('LAF-CSH', 2026)"), denied);
    await scenario(ids, "a receipt goes issued -> sent -> acknowledged and then stops", "office_admin",
      then(cashGift, `select ops.issue_cash_ar('${C1}')`, `select ops.advance_ar(id) from ops.acknowledgment_receipts where donation_id = '${C1}'`,
        `select ops.advance_ar(id) as n from ops.acknowledgment_receipts where donation_id = '${C1}'`),
      (r) => r.ok && r.data[0].n === "acknowledged");
    await scenario(ids, "an acknowledged receipt can't be advanced", "finance",
      then(cashGift, `select ops.issue_cash_ar('${C1}')`, `select ops.advance_ar(id) from ops.acknowledgment_receipts where donation_id = '${C1}'`,
        `select ops.advance_ar(id) from ops.acknowledgment_receipts where donation_id = '${C1}'`, `select ops.advance_ar(id) from ops.acknowledgment_receipts where donation_id = '${C1}'`),
      invalid);
    await scenario(ids, "finance requests a DC certificate for a gift in kind", "finance",
      then(`select ops.request_donee_certificate('${G1}')`, `select control_number as n from ops.donee_certificates where donation_id = '${G1}' and kind = 'in_kind' and amount = 100`), isSeries("DC"));
    await scenario(ids, "and for a cash gift; a certificate is requested once", "finance",
      then(cashGift, `select ops.request_donee_certificate('${C1}')`, `select ops.request_donee_certificate('${C1}')`), invalid);
    await scenario(ids, "the chef can't request a certificate", "chef", () => client.query(`select ops.request_donee_certificate('${G1}')`), denied);
    await scenario(ids, "a released certificate records who released it", "finance",
      then(`select ops.request_donee_certificate('${G1}')`, `select ops.advance_donee_certificate(id) from ops.donee_certificates where donation_id = '${G1}'`,
        `select ops.advance_donee_certificate(id) from ops.donee_certificates where donation_id = '${G1}'`,
        `select ops.advance_donee_certificate(id) as n from ops.donee_certificates where donation_id = '${G1}'`,
        `select status as n from ops.donee_certificates where donation_id = '${G1}' and released_by = auth.uid() and released_at is not null`),
      (r) => r.ok && r.data[0].n === "released");
    await scenario(ids, "the chef can't read the receipt or certificate registers", "chef",
      () => client.query("select count(*)::int as n from ops.acknowledgment_receipts"), (r) => (r.ok && r.data[0].n === 0) || denied(r));
  } else {
    record("0085 scenarios", "SKIP", "0085 not applied (pass it as a pre-flight file)");
  }

  // ---- 0086: campaign totals follow the gifts ----
  const has0086 = (await client.query("select to_regproc('ops.campaign_totals') is not null as ok")).rows[0].ok;
  if (has0086) {
    const K1 = "00000000-0000-4000-8000-0000000d00e1";
    const K2 = "00000000-0000-4000-8000-0000000d00e2";
    const campaigns = `insert into ops.campaigns (id, name, target_amount, raised_amount, start_date) values ('${K1}', 'RLSTEST Appeal', 1000, 999, '2026-10-01'), ('${K2}', 'RLSTEST Other', 1000, 0, '2026-10-01')`;
    const raised = (k) => `select raised_amount::numeric as n from ops.campaigns where id = '${k}'`;
    const gift = (campaign, more = "") => `insert into ops.donations (donor_id, date, receiving_entity, kind, total_value, currency, status, campaign_id) values ('${D1}', '2026-10-13', 'PH_SEC', 'cash', 100, 'PHP', 'finalized', '${campaign}')${more}`;
    const equals = (v) => (r) => r.ok && Number(r.data[0].n) === v;
    await scenario(ids, "a campaign's raised amount is what the database computes, not what the browser sends", "finance", then(campaigns, raised(K1)), equals(0));
    await scenario(ids, "a finalized peso gift raises its campaign; one for another campaign doesn't", "finance",
      then(campaigns, gift(K1), gift(K2), raised(K1)), equals(100));
    await scenario(ids, "a US-dollar gift and a gift pending review are not counted", "finance",
      then(campaigns, gift(K1), gift(K1).replace("'PHP'", "'USD'"), gift(K1).replace("'finalized'", "'pending_review'"), raised(K1)), equals(100));
    await scenario(ids, "moving a gift to another campaign moves the amount", "finance",
      then(campaigns, gift(K1, " returning id"), `update ops.donations set campaign_id = '${K2}' where campaign_id = '${K1}' and donor_id = '${D1}'`, `select (select raised_amount from ops.campaigns where id = '${K2}') - (select raised_amount from ops.campaigns where id = '${K1}') as n`),
      equals(100));
    await scenario(ids, "finalizing a pending gift adds it; deleting a gift removes it", "finance",
      then(campaigns, gift(K1).replace("'finalized'", "'pending_review'"), `update ops.donations set status = 'finalized' where campaign_id = '${K1}'`, `delete from ops.donations where campaign_id = '${K1}' and total_value = 100 and date = '2026-10-13' and id = (select id from ops.donations where campaign_id = '${K1}' order by created_at limit 1)`, raised(K1)),
      equals(0));
    await scenario(ids, "a campaign with gifts can't be deleted", "finance", then(campaigns, gift(K1), `delete from ops.campaigns where id = '${K1}'`), (r) => !r.ok && r.code === "23503");
    await scenario(ids, "finance edits a campaign (name, dates, closed)", "finance",
      then(campaigns, `update ops.campaigns set name = 'RLSTEST Renamed', status = 'closed', end_date = '2026-12-31' where id = '${K1}'`, `select count(*)::int as n from ops.campaigns where id = '${K1}' and status = 'closed' and updated_at >= created_at`), equals(1));
    await scenario(ids, "the chef can't create or change campaigns", "chef", () => client.query(campaigns), denied);
    await scenario(ids, "the chef can't call the totals function", "chef", () => client.query(`select ops.campaign_totals('${K1}')`), denied);
  } else {
    record("0086 scenarios", "SKIP", "0086 not applied (pass it as a pre-flight file)");
  }

  // ---- 0095: gift-in-kind batches split food / non-food ----
  const has0095 = (await client.query("select to_regproc('ops.gik_batches') is not null as ok")).rows[0].ok;
  if (has0095) {
    // One batch on a date nothing else uses: a FOOD line (₱300) and a non-food line (₱200).
    const batch = `insert into inventory.donation_log (id, date, donor_id, valuation_total, item_summary) values ('rlstest-gik-1', '2001-01-02', '${D1}', 500, 'RLSTEST batch');
      insert into inventory.donation_lines (id, donation_id, description, quantity, category, unit_value) values
        ('rlstest-gik-1a', 'rlstest-gik-1', 'RLSTEST rice', 1, (select name from inventory.categories where meal_use limit 1), 300),
        ('rlstest-gik-1b', 'rlstest-gik-1', 'RLSTEST soap', 1, (select name from inventory.categories where meal_use is not true limit 1), 200)`;
    const split = `select food_value::int as food, nonfood_value::int as nonfood, total_value::int as total from ops.gik_batches('2001-01-01', '2001-01-03')`;
    const asOwnerThen = (sql) => async () => {
      await client.query("reset role");
      await client.query(batch);
      await client.query("set local role authenticated");
      return client.query(sql);
    };
    await scenario(ids, "finance sees a batch split into food and non-food", "finance", asOwnerThen(split),
      (r) => r.ok && r.rows === 1 && r.data[0].food === 300 && r.data[0].nonfood === 200 && r.data[0].total === 500);
    await scenario(ids, "the office admin sees the same batches", "office_admin", asOwnerThen(split), rows(1));
    await scenario(ids, "the chef can't read donation totals", "chef", asOwnerThen(split), denied);
    await scenario(ids, "inventory staff can't read them through arkos either", "inventory_staff", asOwnerThen(split), denied);
    await scenario(ids, "a range longer than ten years is refused", "finance", () => client.query("select * from ops.gik_batches('1990-01-01', '2026-01-01')"), (r) => !r.ok && r.code === "22023");
  } else record("0095 gik scenarios", "SKIP", "0095 not applied (pass it as a pre-flight file)");

  // ---- 0087: inventory roles see donor names, not details ----
  const has0087 = (await client.query("select to_regproc('ops.donor_directory') is not null as ok")).rows[0].ok;
  if (has0087) {
    const dirRows = (n) => (r) => r.ok && r.rows === n;
    // 0088 closes the table once Inventory's release is live; until then the old reads still work.
    const closed = !(await client.query("select exists (select 1 from pg_policies where schemaname = 'ops' and tablename = 'donors' and policyname = 'inventory roles read and add donors') as ok")).rows[0].ok;
    if (closed) {
      await scenario(ids, "inventory staff no longer read the donor table (email, phone, TIN)", "inventory_staff", () => client.query(`select email from ops.donors where id = '${D1}'`), (r) => (r.ok && r.rows === 0) || denied(r));
      await scenario(ids, "the chef no longer reads the donor table", "chef", () => client.query(`select name from ops.donors where id = '${D1}'`), (r) => (r.ok && r.rows === 0) || denied(r));
      await scenario(ids, "inventory staff can't insert donors directly any more", "inventory_staff", () => client.query("insert into ops.donors (name, type, tax_jurisdiction) values ('RLSTEST direct', 'individual', 'PH')"), denied);
    } else record("0088 scenarios", "SKIP", "0088 not applied: inventory roles still read ops.donors (apply after Inventory's release)");
    await scenario(ids, "inventory staff look donors up by name through the directory", "inventory_staff", () => client.query("select name from ops.donor_directory('rlstest donor one')"), dirRows(1));
    await scenario(ids, "the chef looks a donor up by id through the directory", "chef", () => client.query(`select name, type, tax_jurisdiction from ops.donor_directory(null, array['${D1}']::uuid[])`), dirRows(1));
    await scenario(ids, "the directory has no email, phone or TIN column", "inventory_staff", () => client.query("select email from ops.donor_directory('x')"), (r) => !r.ok && r.code === "42703");
    await scenario(ids, "finance still reads the donor table in full", "finance", () => client.query(`select email, phone, tin from ops.donors where id = '${D1}'`), dirRows(1));
    await scenario(ids, "inventory staff add a donor; the same name again is the same donor", "inventory_staff",
      then("select id from ops.add_donor_basic('Rlstest New Giver', 'individual', 'PH')", "select id from ops.add_donor_basic('RLSTEST  new giver', 'corporate')", "select count(*)::int as n from ops.donor_directory('rlstest new giver')"),
      (r) => r.ok && r.data[0].n === 1);
    await scenario(ids, "a name needs two letters", "chef", () => client.query("select ops.add_donor_basic('X', 'individual', 'PH')"), (r) => !r.ok && r.code === "22023");
    await scenario(ids, "nobody outside staff reads the directory", null, () => client.query("select name from ops.donor_directory('rlstest')"), (r) => (r.ok && r.rows === 0) || denied(r));
  } else {
    record("0087 scenarios", "SKIP", "0087 not applied (pass it as a pre-flight file)");
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
