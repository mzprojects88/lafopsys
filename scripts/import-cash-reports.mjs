// Reads accounting's cash sheets into ops.cash_gift_lines (0084): the 2024 and 2025 transaction
// reports once, and the 2026 Donation Tracker's CASH tab as a first load (after that LAF
// Inventory's hourly tracker script keeps 2026 current). Nothing joins the donor list here: a
// donors editor confirms each name on Donors > Cash gifts.
//
// Reads only date, donor, payment type, amount, invoice number and notes. The tracker's phone,
// email and address columns are never kept. Sales of donated rice, the LAF pins sale and a test
// transfer among the 2025 rows are left out (they are proceeds, not gifts) and listed.
//
// Usage (a dry run unless --commit):
//   node --env-file=.env.local scripts/import-cash-reports.mjs
//   node --env-file=.env.local scripts/import-cash-reports.mjs --commit
//   ... --only=2024,2025        just those sheets
//   ... --with-2025-noncash     also the 2025 non-cash report (gifts in kind, totals only)
import { Client } from "pg";
import { pgUrl, isProd } from "./lib/db-url.mjs";
import { parseAmount, parseCsv } from "../lib/utils/bank-statement.ts";
import { readCashRows } from "../lib/utils/cash-gifts.ts";

const AUDIT = "1FpYhR7cvB13puk1xa0aJX6CCmzWyOy_i0G3B5ndR6qw"; // LAF DONOR LISTS_FOR INVOICING_audit
const TRACKER = "1JZUTyMou9iTVb8kotsEpzclRpXitJUWI9kk9Edt0DcI"; // 2026 LAF Donation Tracker
const byName = (id, tab) => `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
const byGid = (id, gid) => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;

// Where each field is (0-based), as the sheet comes back from Google.
const SHEETS = {
  "2024": { year: 2024, url: byName(AUDIT, "Transaction Report (Jan-Dec 2024)"), cols: { date: 1, invoice: 3, donor: 4, memo: 5, amount: 6 }, total: 6 },
  "2025": { year: 2025, url: byName(AUDIT, "TRANSACTION REPORT (JAN-DEC 2025)"), cols: { date: 0, donor: 4, memo: 5, amount: 6, invoice: 7 }, total: 6 },
  "2025_noncash": { year: 2025, url: byName(AUDIT, "Copy of 2025 NON-CASH DONATIONS_AFS"), cols: { date: 1, donor: 4, memo: 5, amount: 6, invoice: 7 }, total: 6, kind: "in_kind" },
  "2026": { year: 2026, url: byGid(TRACKER, "1754595582"), cols: { date: 0, donor: 2, method: 7, amount: 8, invoice: 9, notes: 11 } },
};

const commit = process.argv.includes("--commit");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const wanted = Object.keys(SHEETS).filter((s) => (only ? only.includes(s) : s !== "2025_noncash" || process.argv.includes("--with-2025-noncash")));
const peso = (n) => `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const reads = [];
for (const source of wanted) {
  const sheet = SHEETS[source];
  const response = await fetch(sheet.url, { redirect: "follow" });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("text/csv")) {
    console.error(`${source}: Google returned ${response.status} ${type}. Is the sheet still shared by link?`);
    process.exit(1);
  }
  const grid = parseCsv(await response.text(), true); // blank rows kept: "row 25" must be the sheet's row 25
  // A date outside the sheet's own year, or after today in Manila, is a typing mistake: reported, not read.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const read = readCashRows(grid.slice(1), sheet.cols, { firstRow: 2, kind: sheet.kind ?? "cash", year: sheet.year, today });
  const sum = read.lines.reduce((s, l) => s + l.amount, 0);
  const leftOut = read.leftOut.reduce((s, t) => s + (parseAmount(/ ([\d,]+\.\d\d) "/.exec(t)?.[1]) ?? 0), 0);
  // The report's own "Total for ..." line: what we read plus what we left out must equal it.
  const totalRow = sheet.total === undefined ? null : grid.find((r) => /^total for /i.test((r[0] ?? "").trim()));
  const stated = totalRow ? parseAmount((totalRow[sheet.total] ?? "").replace(/PHP/i, "")) : null;
  console.log(`\n${source}: ${read.lines.length} gifts, ${peso(sum)}, ${new Set(read.lines.map((l) => l.donor_name.toLowerCase())).size} names`);
  if (stated !== null) {
    const diff = Math.round((stated - sum - leftOut) * 100) / 100;
    console.log(`  the sheet's own total: ${peso(stated)} -> ${diff === 0 ? "matches" : `DIFFERS by ${peso(diff)}`}${leftOut ? ` (with ${peso(leftOut)} left out)` : ""}`);
    if (diff !== 0 && commit) {
      console.error("  Not writing a sheet that doesn't add up to its own total.");
      process.exit(1);
    }
  }
  for (const p of read.problems) console.log(`  can't read -> ${p}`);
  for (const t of read.leftOut) console.log(`  left out (not a gift) -> ${t}`);
  reads.push({ source, read });
}

if (!commit) {
  console.log("\nDry run: nothing was written. Add --commit to write the lines (no donor or gift is created by this script).");
  process.exit(0);
}

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD in the env file.");
  process.exit(1);
}
const client = new Client({ connectionString: pgUrl(password) });
await client.connect();
try {
  await client.query("begin");
  for (const { source, read } of reads) {
    const { rows } = await client.query("select ops.receive_cash_lines($1, $2::jsonb, $3::jsonb) as result", [source, JSON.stringify(read.lines), JSON.stringify(read.problems)]);
    console.log(`${source}:`, rows[0].result);
  }
  await client.query("commit");
  console.log(`Written to ${isProd() ? "PRODUCTION (the LAF official project)" : "the current project"}. Next: Donors > Cash gifts, to confirm the names.`);
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("Nothing was written:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
