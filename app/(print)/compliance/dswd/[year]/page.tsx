import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";
import { dayKey } from "@/lib/utils/dtr";
import { formatAmount2 } from "@/lib/utils/money";
import { annexEFinancial, annexGAccomplishment, expenseSourceLabel, type CashEntryLike, type DonorLike, type IncomeBucket } from "@/lib/utils/dswd-annex";
import type { BankTxnLike } from "@/lib/utils/finance-summary";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";

const peso = (v: number) => formatAmount2(Math.round(v * 100));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BUCKET_TITLES: Record<IncomeBucket, string> = {
  local: "B.1 Local (organisations and individual donors)",
  foreign: "B.2 International / foreign",
  government: "B.3 Government",
  others: "B.4 Others (interest income, service fees)",
};

type BankRow = { posting_date: string; row_seq: number; debit: string; credit: string; running_balance: string; category: BankTxnLike["category"] };

/** PostgREST caps a response at 1,000 rows; the statement spans years, so page through it. */
async function allBankRows(supabase: Awaited<ReturnType<typeof createClient>>, upTo: string): Promise<BankTxnLike[]> {
  const out: BankTxnLike[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.schema("ops").from("bank_transactions").select("posting_date, row_seq, debit, credit, running_balance, category").lte("posting_date", upTo).order("posting_date").order("row_seq").range(from, from + 999);
    const rows = (data ?? []) as BankRow[];
    for (const r of rows) out.push({ postingDate: r.posting_date, rowSeq: r.row_seq, debit: Number(r.debit), credit: Number(r.credit), runningBalance: Number(r.running_balance), category: r.category });
    if (rows.length < 1000) break;
  }
  return out;
}

/**
 * DSWD Annex E (financial report, DSWD-GF-010) and Annex G (annual
 * accomplishment report) figures for one calendar year, drafted from the
 * bank statement, the receipt logs, the donor records, admissions, the
 * daily census and the meal logs. Laid out in the forms' sections so the
 * numbers can be copied onto the templates; what the system does not
 * hold is left blank to fill by hand. A Server Component under the
 * caller's RLS, and gated to the people who can see the whole picture:
 * a social worker would get the census but not the bank, and a page
 * with peso zeroes would read as a fact.
 */
export default async function DswdFiguresPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: yearStr } = await params;
  const year = Number(yearStr);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: me } = await supabase.schema("shared").from("staff").select("role, is_hr, active").eq("id", user.id).maybeSingle();
  const allowed = !!me?.active && (me.role === "admin" || me.role === "finance" || me.is_hr);
  if (!allowed) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-sm">
        <p className="font-medium">Admins, finance and HR only.</p>
        <p className="text-neutral-600">The DSWD figures draw on the bank statement, which only those accounts can read.</p>
      </div>
    );
  }

  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [txns, { data: entries }, { data: donors }, { data: patients }, { data: census }, { data: meals }, { data: careCart }] = await Promise.all([
    allBankRows(supabase, to),
    supabase.schema("ops").from("cash_entries").select("id, date, amount, direction, donor_name, source_sheet, approval_status, duplicate_of_id, source, currency").gte("date", from).lte("date", to),
    supabase.schema("ops").from("donors").select("name, type, tax_jurisdiction"),
    // admitted_at is a timestamp: bound the year in Manila time, and hand the module Manila day keys.
    supabase.schema("ops").from("patients").select("admitted_at, sex").gte("admitted_at", `${from}T00:00:00+08:00`).lt("admitted_at", `${year + 1}-01-01T00:00:00+08:00`),
    supabase.schema("ops").from("census_snapshots").select("date, in_house").gte("date", from).lte("date", to),
    supabase.schema("ops").from("meal_services").select("date, headcount").gte("date", from).lte("date", to),
    supabase.schema("ops").from("care_cart_logs").select("date, headcount").gte("date", from).lte("date", to),
  ]);

  const cashEntries: CashEntryLike[] = (entries ?? []).map((e) => ({
    id: e.id,
    date: e.date,
    amount: Number(e.amount),
    direction: e.direction as "inflow" | "outflow",
    donorName: e.donor_name,
    sourceSheet: e.source_sheet,
    approvalStatus: e.approval_status,
    duplicateOfId: e.duplicate_of_id,
    source: e.source,
    currency: e.currency as "PHP" | "USD",
  }));
  const donorList: DonorLike[] = (donors ?? []).map((d) => ({ name: d.name, type: d.type as DonorLike["type"], taxJurisdiction: d.tax_jurisdiction as DonorLike["taxJurisdiction"] }));
  const annexE = annexEFinancial(txns, cashEntries, donorList, year);
  const annexG = annexGAccomplishment(
    (patients ?? []).map((p) => ({ admittedAt: p.admitted_at ? dayKey(new Date(p.admitted_at)) : null, sex: p.sex as "M" | "F" | null })),
    (census ?? []).map((c) => ({ date: c.date, inHouse: c.in_house })),
    (meals ?? []).map((m) => ({ date: m.date, headcount: m.headcount })),
    (careCart ?? []).map((m) => ({ date: m.date, headcount: m.headcount })),
    year
  );
  const blank = <span className="text-neutral-400">— enter manually</span>;

  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/compliance" className="text-xs underline">
          Back to Compliances
        </Link>
        <PrintButton />
      </div>

      {annexE.monthsWithoutStatements.length > 0 ? (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:hidden">
          No bank statement lines for {annexE.monthsWithoutStatements.map((m) => MONTHS[m - 1]).join(", ")} {year}: the income and expenditure totals below are short by those months. Import the statements under Financial, then reload.
        </div>
      ) : null}

      <div className="rounded-xl border border-neutral-300 p-6 print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-300 pb-4">
          <div className="flex items-center gap-3">
            <Image src="/logo/laf-mark.png" alt="" width={48} height={51} />
            <div>
              <div className="text-base font-semibold">Little Ark Foundation Inc.</div>
              <div className="text-xs text-neutral-600">DSWD annual report figures (Annex E financial report, Annex G accomplishment report)</div>
            </div>
          </div>
          <div className="text-right text-xs">
            <div className="font-medium">Calendar year {year}</div>
            <div>Drafted {formatDate(dayKey(new Date()))}</div>
          </div>
        </header>

        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide">Annex E · Financial report (DSWD-GF-010)</h2>
        <Section title="I. Resources received">
          <Row k="A. Balance of previous year" v={annexE.previousBalance === null ? blank : peso(annexE.previousBalance)} />
          <Row k="B. Income for the current year (bank credits)" v={peso(annexE.totalIncome)} strong />
        </Section>
        {(Object.keys(BUCKET_TITLES) as IncomeBucket[]).map((b) => (
          <Section key={b} title={BUCKET_TITLES[b]}>
            {annexE.buckets[b].donors.length === 0 ? <Row k="None" v={peso(0)} /> : annexE.buckets[b].donors.map((d) => <Row key={d.donorName} k={`${d.donorName}${d.gifts > 1 ? ` (${d.gifts} gifts)` : ""}`} v={peso(d.amount)} />)}
            {b === "local" && annexE.unattributed > 0 ? <Row k="Bank credits not attributed in the receipt logs" v={peso(annexE.unattributed)} muted /> : null}
            <Row k="Sub-total" v={peso(b === "local" ? annexE.buckets.local.total + annexE.unattributed : annexE.buckets[b].total)} strong />
          </Section>
        ))}
        {annexE.receiptsExceedBank ? <p className="mt-2 text-xs text-rose-700">The receipt logs total more than the bank received this year: some receipts are re-records not yet folded. Mark the duplicates under Financial before filing.</p> : null}
        <Section title="C. Grand total income">
          <Row k="Balance of previous year + income for the current year" v={annexE.previousBalance === null ? blank : peso(annexE.previousBalance + annexE.totalIncome)} strong />
        </Section>

        <Section title="II. Expenditures for the period (itemised)">
          {annexE.expenseLines.map((l) => (
            <Row key={l.source} k={expenseSourceLabel(l.source)} v={`${peso(l.amount)}  (${(l.pct * 100).toFixed(1)}%)`} />
          ))}
          {annexE.unclassifiedExpenses > 0 ? <Row k="Bank debits not yet classified" v={`${peso(annexE.unclassifiedExpenses)}  (${annexE.totalExpenses > 0 ? ((annexE.unclassifiedExpenses / annexE.totalExpenses) * 100).toFixed(1) : "0.0"}%)`} muted /> : null}
          <Row k="Total expenditures (bank debits)" v={peso(annexE.totalExpenses)} strong />
        </Section>

        <Section title="III. Balance">
          <Row k="Previous balance + income − expenditures" v={annexE.computedEndingBalance === null ? blank : peso(annexE.computedEndingBalance)} strong />
          <Row k={`Cash in bank per statement${annexE.bankEndingAsOf ? ` as of ${formatDate(annexE.bankEndingAsOf)}` : ""}`} v={annexE.bankEndingBalance === null ? blank : peso(annexE.bankEndingBalance)} />
        </Section>
        <p className="mt-2 text-[11px] text-neutral-600">
          Totals are the bank statement&apos;s (every credit other than interest is a donation; every debit an expense). The donor list and the local / foreign / government split come from the receipt logs, with re-records folded; the itemised expenses come from the outflows classified against the statement. In-kind donations are not part of this report&apos;s cash figures.
        </p>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide">Annex G · Annual accomplishment report</h2>
        <Section title="II.2 Statistical accomplishment">
          <Row k="Beneficiaries served (patients admitted in the year), male" v={String(annexG.beneficiaries.male)} />
          <Row k="Beneficiaries served, female" v={String(annexG.beneficiaries.female)} />
          {annexG.beneficiaries.unknown > 0 ? <Row k="Sex not recorded" v={String(annexG.beneficiaries.unknown)} muted /> : null}
          <Row k="Total beneficiaries (excluding parents and companions)" v={String(annexG.beneficiaries.total)} strong />
          <Row k={`Housing accommodation, bed nights${annexG.censusFrom ? ` (census from ${formatDate(annexG.censusFrom)}, ${annexG.censusDays} days)` : ""}`} v={annexG.censusDays > 0 ? String(annexG.bedNights) : blank} />
          <Row k="Transportation support, patients transported" v={blank} />
          <Row k="Meal subsidy, hot meals served" v={annexG.meals > 0 ? String(annexG.meals) : blank} />
          <Row k="Care cart, people served" v={annexG.careCartServed > 0 ? String(annexG.careCartServed) : blank} />
          <Row k="Activity centre participants" v={blank} />
          <Row k="Blood-letting activities" v={blank} />
        </Section>
        <p className="mt-2 text-[11px] text-neutral-600">Beneficiaries count admissions dated in the year; patients carried over from the year before are not included. Bed nights add up the daily in-house census; transports and activity-centre figures are not logged in the system yet.</p>

        <footer className="mt-6 flex items-center justify-between text-[10px] text-neutral-500">
          <span>Figures to be reviewed and signed by the head of agency before filing.</span>
          <span>Generated by LAF Operating System</span>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <div className="mb-1 text-xs font-semibold text-neutral-700">{title}</div>
      <table className="w-full text-xs">
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

function Row({ k, v, strong, muted }: { k: string; v: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <tr className={strong ? "font-semibold" : muted ? "text-neutral-500" : ""}>
      <td className="py-0.5 pr-2">{k}</td>
      <td className="whitespace-pre py-0.5 text-right tabular-nums">{v}</td>
    </tr>
  );
}
