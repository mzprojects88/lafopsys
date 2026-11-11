// Reads the voucher registers (PV, PCV and GCash tabs of the 2026 Payment Voucher workbook, Aug-Oct) into ArkOS as
// history vouchers (0134: source 'sheet', their own numbers kept, flagged where Finance must clean up). Each register
// row gets a fixed id, so running it again (at the start date) adds only the rows added since; rows already in are
// never changed (Finance may have corrected their codes).
//
// Input: the six tabs downloaded as CSV into one folder, named as the tabs are:
//   PV Register.csv, PV Particulars.csv, PCV Register.csv, Petty Cash Details.csv, GFC Register.csv, GFC Details.csv
// Prints counts only, never a name.
//
// Usage (a dry run unless --commit):
//   node --env-file=.env.local scripts/import-voucher-history.mjs --dir=<folder>             dry run against dev
//   node --env-file=.env.prod.local scripts/import-voucher-history.mjs --dir=<folder>        dry run against production
//   ... --commit          writes (production only: rows written on dev would reach production through the hourly sync)
//   ... --cash-book       also posts the paid ones to the cash book, only when Financial Settings allows it
//                         (finance_settings.history_to_cash_book, off until the accountant decides); entries that look
//                         like one already in the cash book (same date and amount) are skipped and counted
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { pgUrl, isProd } from "./lib/db-url.mjs";
import { parseCsv } from "../lib/utils/bank-statement.ts";
import { readHistory } from "../lib/utils/voucher-history.ts";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dir = arg("dir");
const commit = process.argv.includes("--commit");
const cashBook = process.argv.includes("--cash-book");
// --try: every write in a transaction, then rolled back (allowed on dev): proves the writes before a real run.
const tryRun = process.argv.includes("--try");
if (!dir) throw new Error("Give the folder of CSV files: --dir=<folder>");
if (commit && !isProd()) throw new Error("Write to production only (--env-file=.env.prod.local, with approval): dev rows reach production through the hourly sync.");
const TABS = [
  ["PV", "PV Register.csv", "PV Particulars.csv"],
  ["PCV", "PCV Register.csv", "Petty Cash Details.csv"],
  ["GCV", "GFC Register.csv", "GFC Details.csv"],
];
const csv = (file) => parseCsv(readFileSync(join(dir, file), "utf8"));

const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  // One client runs one query at a time.
  const { rows: accounts } = await c.query("select id, code, name from ops.coa_accounts where code is not null and not is_header and active and review_note is null");
  const { rows: codes } = await c.query("select id, tier, code, parent_id, account_prefixes from ops.fin_codes");
  const { rows: staff } = await c.query("select id, first_name, last_name from shared.staff");
  const { rows: [settings] } = await c.query("select history_to_cash_book from ops.finance_settings");
  const accountsByCode = new Map();
  for (const a of accounts) accountsByCode.set(a.code, [...(accountsByCode.get(a.code) ?? []), { id: a.id, name: a.name }]);
  const byCode = (tier, code) => codes.find((x) => x.tier === tier && x.code === code)?.id ?? null;
  const t3s = codes.filter((x) => x.tier === "T3");
  const adm = byCode("T1", "ADM");
  const classOf = (code) => {
    const t3 = t3s.find((x) => (x.account_prefixes ?? []).some((p) => code.startsWith(p)));
    return t3 ? { t1: t3.parent_id, t3: t3.id } : { t1: adm, t3: null };
  };
  const FUNDS = { "one child": "OC", life: "LIFE", unrestricted: "UNR", laf: "UNR" };
  const fundOf = (label) => (FUNDS[label.trim().toLowerCase()] ? byCode("T2", FUNDS[label.trim().toLowerCase()]) : null);
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const full = new Map(staff.map((s) => [norm(`${s.first_name} ${s.last_name}`), s.id]));
  const firsts = new Map();
  for (const s of staff) firsts.set(norm(s.first_name), [...(firsts.get(norm(s.first_name)) ?? []), s.id]);
  const staffOf = (name) => full.get(norm(name)) ?? (firsts.get(norm(name))?.length === 1 ? firsts.get(norm(name))[0] : null);
  const ctx = { accountsByCode, classOf, fundOf, staffOf };

  const all = [];
  for (const [type, reg, det] of TABS) {
    const { vouchers, skipped, orphanDetails } = readHistory(type, csv(reg), csv(det), ctx);
    all.push(...vouchers);
    const reasons = {};
    for (const v of vouchers) for (const r of v.reasons) reasons[r] = (reasons[r] ?? 0) + 1;
    const dates = vouchers.map((v) => v.date).filter(Boolean).sort();
    const signers = vouchers.flatMap((v) => v.signers);
    console.log(`${type}: ${vouchers.length} vouchers (${skipped} rows without a number skipped; ${orphanDetails} detail rows whose number isn't in the register left out), ${vouchers.reduce((s, v) => s + v.lines.length, 0)} lines, ` +
      `PHP ${vouchers.reduce((s, v) => s + v.total, 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}, ${dates[0] ?? "?"} to ${dates.at(-1) ?? "?"}`);
    console.log(`   status: ${["prepared", "approved", "released", "cancelled"].map((s) => `${s} ${vouchers.filter((v) => v.status === s).length}`).join(", ")}; paid ${vouchers.filter((v) => v.paidOn).length}`);
    console.log(`   to clean up: ${vouchers.filter((v) => v.reasons.length).length} vouchers; by reason: ${Object.entries(reasons).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
    if (signers.length) console.log(`   signers: ${signers.length}, matched to a staff account ${signers.filter((s) => s.staffId).length}`);
  }

  // Cash book: what a posting would add, and what it would skip as already there (same date and amount).
  // Only what the register says was paid: an approval alone is not money out.
  const paid = all.filter((v) => v.paidOn);
  const { rows: book } = await c.query("select date::text d, amount::numeric a from ops.cash_entries where direction = 'outflow'");
  const inBook = new Set(book.map((b) => `${b.d}|${Number(b.a).toFixed(2)}`));
  const overlap = paid.filter((v) => inBook.has(`${v.paidOn ?? v.date}|${v.total.toFixed(2)}`));
  console.log(`cash book: ${paid.length} paid vouchers could post; ${overlap.length} look already there (would be skipped). Setting history_to_cash_book is ${settings.history_to_cash_book ? "ON" : "OFF"}.`);

  if (!commit && !tryRun) {
    console.log("\nDry run: nothing written. Add --commit (production, with approval) to write.");
  } else {
    if (cashBook && !settings.history_to_cash_book) throw new Error("--cash-book refused: Financial Settings › General has history to the cash book OFF.");
    await c.query("begin");
    let vIn = 0, lIn = 0, eIn = 0, bIn = 0;
    for (const v of all) {
      const id = (await c.query("select md5($1)::uuid id", [`hist:${v.key}`])).rows[0].id;
      const occ = v.key.split(":").at(-1);
      const r = await c.query(
        `insert into ops.vouchers (id, source, voucher_type, voucher_number, legacy_number, kind, status, purpose, payee_text, t2_id, total, legacy_link, needs_cleanup, pay_method, created_at, submitted_at, cleanup_reasons, released_at)
         values ($1, 'sheet', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, coalesce(($14::date)::timestamp at time zone 'Asia/Manila', now()), ($14::date)::timestamp at time zone 'Asia/Manila', $15,
                 ($16::date)::timestamp at time zone 'Asia/Manila')
         on conflict (id) do nothing`,
        [id, v.type, `${v.type} ${v.number}${occ === "1" ? "" : ` (${occ})`}`, v.number, v.type === "PCV" ? "petty_cash" : "supplier", v.status, v.purpose, v.payee, v.fundId, v.total, v.link,
         v.reasons.length > 0, v.type === "GCV" ? "gcash" : "cash", v.date, v.reasons, v.status === "released" ? v.paidOn : null]
      );
      if (!r.rowCount) continue;
      vIn++;
      for (const l of v.lines) {
        await c.query(
          `insert into ops.voucher_lines (id, voucher_id, sort, description, qty, unit_cost, amount, or_number, account_id, t1_id, t3_id, legacy_code, legacy_account_name)
           values (md5($1)::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict (id) do nothing`,
          [`hist:${v.key}:line:${l.sort}`, id, l.sort, l.description, l.qty > 0 ? l.qty : 1, Math.max(0, l.unitCost), Math.max(0, l.amount), l.orNumber, l.accountId, l.t1Id, l.t3Id, l.legacyCode, l.legacyAccountName]
        );
        lIn++;
      }
      const at = v.date ?? null;
      for (const s of v.signers) {
        await c.query(`insert into ops.voucher_events (voucher_id, action, actor, signer_text, source, at) values ($1, $2, $3, $4, 'sheet', coalesce(($5::date)::timestamp at time zone 'Asia/Manila', now()))`, [id, s.action, s.staffId, s.text, at]);
        eIn++;
      }
      await c.query(`insert into ops.voucher_events (voucher_id, action, note, source, at) values ($1, 'history', $2, 'sheet', coalesce(($3::date)::timestamp at time zone 'Asia/Manila', now()))`,
        [id, `From the ${v.type} register${v.paidOn ? `; paid ${v.paidOn}` : ""}${v.reasons.length ? `; to clean up: ${v.reasons.join(", ")}` : ""}.`, v.paidOn ?? at]);
      eIn++;
      if (cashBook && v.paidOn && !inBook.has(`${v.paidOn}|${v.total.toFixed(2)}`)) {
        const b = await c.query(
          `insert into ops.cash_entries (source_id, date, direction, source, entity, currency, amount, description, approval_status)
           values ($1, $2, 'outflow', 'voucher_history', 'PH_SEC', 'PHP', $3, $4, 'approved') on conflict (source_id) do nothing`,
          [`voucher:${v.key}`, v.paidOn, v.total, `${v.type} ${v.number}: ${v.purpose}`.slice(0, 500)]
        );
        bIn += b.rowCount;
      }
    }
    if (tryRun) {
      const { rows: [n] } = await c.query(
        "select (select count(*) from ops.vouchers where source = 'sheet')::int v, (select count(*) from ops.vouchers where source = 'sheet' and needs_cleanup)::int clean, (select count(*) from ops.voucher_lines l join ops.vouchers v on v.id = l.voucher_id where v.source = 'sheet' and l.account_id is null)::int no_account"
      );
      console.log(`\nTry: in the transaction ${n.v} history vouchers, ${n.clean} to clean up, ${n.no_account} lines without an account.`);
    }
    await c.query(tryRun ? "rollback" : "commit");
    console.log(`\n${tryRun ? "Rolled back; would write" : "Written"}: ${vIn} vouchers, ${lIn} lines, ${eIn} events${cashBook ? `, ${bIn} cash-book entries` : ""}. Rows already in were left as they are.`);
  }
} catch (e) {
  await c.query("rollback").catch(() => undefined);
  throw e;
} finally {
  await c.end();
}
