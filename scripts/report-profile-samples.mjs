// Sample PDFs of the report profiles (13 Nov 2026), for reviewing the format: each saved profile drawn by the app's own
// builder (lib/utils/operations-report.ts) and PDF renderer (lib/pdf/report-doc.ts), filled with DUMMY figures.
// Nothing is read but the profiles' designs (a JSON file) and the letterhead text; nothing is written to a database.
//   node scripts/report-profile-samples.mjs <profiles.json> <out-dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { operationsReport } from "../lib/utils/operations-report.ts";
import { IMPACT_GROUPS, bucketsFor, periodGrain } from "../lib/utils/program-impact.ts";
import { buildReportPdf } from "../lib/pdf/report-doc.ts";

const [profilesFile, outDir] = process.argv.slice(2);
if (!profilesFile || !outDir) throw new Error("usage: node scripts/report-profile-samples.mjs <profiles.json> <out-dir>");
const profiles = JSON.parse(readFileSync(profilesFile, "utf8"));
mkdirSync(outDir, { recursive: true });

// Repeatable dummy numbers.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (lo, hi) => Math.round(lo + rand() * (hi - lo));

// The periods as the page's chips give them on a fixed day, so every sample reads the same.
const PERIODS = {
  this_month: { window: { from: "2026-11-01", to: "2026-11-30" }, previous: { from: "2026-10-01", to: "2026-10-31" }, label: "Nov 2026", prev: "Oct 2026" },
  last_month: { window: { from: "2026-10-01", to: "2026-10-31" }, previous: { from: "2026-09-01", to: "2026-09-30" }, label: "Oct 2026", prev: "Sep 2026" },
  this_year: { window: { from: "2026-01-01", to: "2026-12-31" }, previous: { from: "2025-01-01", to: "2025-12-31" }, label: "2026", prev: "2025" },
  this_week: { window: { from: "2026-11-09", to: "2026-11-15" }, previous: { from: "2026-11-02", to: "2026-11-08" }, label: "Nov 9 – Nov 15, 2026", prev: "Nov 2 – Nov 8, 2026" },
};
// Per day, roughly what the house sees.
const DAILY = {
  housing: [28, 40], transport_to_nch: [4, 12], transport_to_laf: [4, 12], meals_breakfast: [20, 34], meals_lunch: [24, 38], meals_dinner: [24, 38],
  care_cart_1000: [10, 30], care_cart_1200: [20, 45], care_cart_1700: [10, 30], care_cart_volunteers: [2, 6], center_nch_participants: [3, 9],
  center_nch_hours: [2, 4], center_nch_volunteers: [1, 3], center_laf_volunteers: [0, 2], caf_nights: [3, 8],
};
const days = (w) => Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86_400_000) + 1;
/** Dummy Program Impact rows for a window, by its buckets (as ops.program_impact_range returns them). */
function rowsFor(w, grain) {
  const buckets = bucketsFor(w, grain);
  const per = days(w) / buckets.length;
  return buckets.flatMap((b) =>
    IMPACT_GROUPS.flatMap((g) => g.lines).map((l) => {
      const [lo, hi] = DAILY[l.key] ?? [1, 5];
      return { line: l.key, bucket: b.key, native: Math.round(between(lo, hi) * per), fromSheet: 0 };
    }),
  );
}
const fig = (label, value, previous, ytd, unit, goal) => ({ label, value, previous, ytd, unit, goal });
const money = (lo, hi) => between(lo, hi) * 100;

for (const p of profiles) {
  const period = PERIODS[p.period] ?? PERIODS.this_month;
  const { window, previous } = period;
  const grain = periodGrain(window);
  const totalsOnly = p.columns_mode !== "columns";
  const buckets = bucketsFor(window, grain);
  const rows = rowsFor(window, grain);
  const prevRows = rowsFor(previous, periodGrain(previous));
  const ytdBefore = window.from > "2026-01-01" ? rowsFor({ from: "2026-01-01", to: "2026-10-31" }, "month") : [];
  const scale = Math.max(1, days(window) / 30);
  const byBucket = (make) => buckets.map((b) => ({ label: b.label, ...make() }));

  const extras = {
    headline: {
      figures: [
        fig("Bed nights provided", 1020 * scale, 940 * scale, 9480, ""),
        fig("Patient and caregiver rides", 236 * scale, 251 * scale, 2134, ""),
        fig("Meals served", 2610 * scale, 2402 * scale, 23950, ""),
        fig("Child visits (Activity Center @ NCH)", 158 * scale, 141 * scale, 1460, ""),
        fig("Care Cart meals (served at NCH)", 2210 * scale, 2075 * scale, 19840, ""),
        fig("Unique patients admitted", 41, 37, 128, ""),
        fig("Cash donations", 186500 * scale, 152300 * scale, 1620400, "PHP"),
        fig("Expenses (paid vouchers)", 241800 * scale, 228950 * scale, 2361000, "PHP"),
      ],
    },
    occupancy: {
      figures: [fig("Families a night (average)", 15.6, 14.9, 15.1, ""), fig("Beds in use (average, %)", 86.7, 82.8, 83.9, ""), fig("Family-nights", 468 * scale, 446 * scale, 4612, ""), fig("Nights with nobody in", 0, 1, 2, "")],
      note: "18 beds (13 regular, 5 temporary mattresses) on the floor plan; families housed each night from the nights finalized in the app, else the House Sheet. Busiest night: 2026-11-07 with 18 families.",
    },
    expenses: {
      figures: p.fund_code
        ? [fig("Paid", 64250 * scale, 58900 * scale, 612400, "PHP"), fig("Vouchers paid", 23, 19, 214, "")]
        : [
            fig("Paid", 241800 * scale, 228950 * scale, 2361000, "PHP"),
            fig("Approved budget for these days", 260000 * scale, 260000 * scale, 2600000, "PHP"),
            fig("Vouchers paid", 87, 79, 812, ""),
            fig("Spending per bed night", 237.06, 243.56, 249.05, "PHP"),
          ],
      byAccount: [
        ["5100 Food and provisions", 92400], ["5932 Travels and meals", 41250], ["5210 Utilities", 33800], ["5310 Fuel and oil", 28600],
        ["5400 Medical supplies", 19750], ["5120 Household supplies", 14300], ["5600 Repairs and maintenance", 7900], ["5700 Communication", 3800],
      ].map(([label, amount]) => ({ label, amount: Math.round((p.fund_code ? amount * 0.27 : amount) * scale) })),
      byFund: p.fund_code ? [{ label: "One Child (OC)", amount: 64250 * scale }] : [{ label: "Unrestricted (UNR)", amount: 151300 * scale }, { label: "One Child (OC)", amount: 64250 * scale }, { label: "LIFE (LIFE)", amount: 26250 * scale }],
      note: p.fund_code
        ? `Paid from the ${p.fund_code} fund only, by the day paid. Budgets aren't set by fund, so there is no budget line.`
        : "Paid vouchers by the day paid (fund top-ups and cash advances left out; a liquidation counts the spending), against the approved budget's share of these days. Spending per bed night is all spending divided by the period's bed nights.",
    },
    transport: { figures: [fig("Trips", 58, 61, 552), fig("Kilometres", 1840, 1912, 17420, "km"), fig("Fuel spent", 28600, 30150, 271900, "PHP")], rows: byBucket(() => ({ trips: between(8, 20), km: between(250, 600), fuel: money(40, 90) })) },
    caf: { figures: [fig("Billed", 84000, 79500, 812000, "PHP"), fig("Paid", 79500, 72000, 744000, "PHP"), fig("Nights absorbed", 12, 9, 101)], rows: [{ label: period.label, billed: 84000, paid: 79500, absorbed: 12 }] },
    donations: {
      figures: [
        fig("Cash gifts", 186500, 152300, 1620400, "PHP"),
        fig("Gifts in kind", 64200, 71800, 655900, "PHP"),
        { ...fig("Gifts in kind: food", 41800, 46300, 412500, "PHP"), part: true },
        { ...fig("Gifts in kind: non-food", 22400, 25500, 243400, "PHP"), part: true },
        fig("Cash gifts (count)", 34, 29, 311, ""),
        fig("Gifts in kind (count)", 21, 24, 198, ""),
      ],
      rows: byBucket(() => ({ cash: money(200, 900), food: money(80, 300), nonFood: money(40, 200) })),
    },
    staff: { figures: [fig("Hours worked", 1612, 1580, 15230, "h"), fig("Late arrivals", 6, 9, 71)], rows: byBucket(() => ({ hours: between(300, 450), late: between(0, 4) })) },
    inventory: { figures: [fig("Food received", 41800, 46300, 412500, "PHP"), fig("Non-food received", 22400, 25500, 243400, "PHP")], rows: byBucket(() => ({ food: money(60, 160), nonFood: money(30, 90) })) },
  };

  const { spec } = operationsReport({
    sections: p.sections,
    rows,
    previous: prevRows,
    buckets,
    extras,
    period: period.label,
    previousPeriod: period.prev,
    totalsOnly,
    ytdRows: ytdBefore,
    ytdLabel: "YTD 2026",
    goalYear: 2026,
    goals: {
      Housing: { label: "House 12,000 people-nights a year", lines: ["housing"], target: 12000 },
      "Meals @ LAF House": { label: "Serve 30,000 meals a year", lines: ["meals_breakfast", "meals_lunch", "meals_dinner"], target: 30000 },
    },
    styles: p.charts,
    comparisons: p.comparisons,
    notes: { Housing: "3 nights of this period came from the House Sheet: nobody finalized them in the app." },
    title: p.name,
    subtitle: p.description,
  });
  spec.filters = ["SAMPLE WITH DUMMY FIGURES - for reviewing the layout only, not real data"];
  if (p.include_ai) {
    spec.analysis = "Sample analysis (dummy): the period's figures are compared with the period before and the year so far; the AI writes two or three sentences here per report and one per section when the AI analysis is kept.";
    for (const s of spec.sections) s.analysis = `Sample analysis for ${s.heading} (dummy text).`;
  }
  const pdf = buildReportPdf(spec, {
    header: "SEC 2021070019208-08 · BIR TIN 601-322-056-00000",
    accreditation: "DSWD Accreditation No. DSWD-SB-RL-2026-000131",
    orgAddress: "35 Tulip St., Brgy. Roxas, Quezon City, 1103",
    generatedAt: "13 Nov 2026 (sample)",
    generatedBy: "Sample, dummy figures",
  });
  const file = `${outDir}/LAF-${p.name.replace(/[^A-Za-z0-9]+/g, "-")}-SAMPLE.pdf`;
  writeFileSync(file, pdf);
  console.log(`${p.name}: ${spec.sections.length} sections, ${Math.round(pdf.length / 1024)} KB -> ${file}`);
}
