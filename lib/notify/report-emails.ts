import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthlySummary, type BankTxnLike } from "@/lib/utils/finance-summary";
import { esc, reportMonth } from "@/lib/notify/schedule";

export type ReportKey = "monthly_summary" | "programs" | "caf_billing";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const peso = (n: number) => `PHP ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const appUrl = () => (process.env.APP_BASE_URL || "https://arkos.littlearkfoundation.org").replace(/\/$/, "");

/** The email around a report: a heading, a small table, a note and a link into the app. */
function frame(title: string, rows: [string, string][], note: string, path: string): string {
  const cells = rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#555">${esc(k)}</td><td style="padding:6px 0;font-weight:600;text-align:right">${esc(v)}</td></tr>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1d2939;max-width:560px">
<p style="color:#667085;margin:0 0 4px">Little Ark Foundation</p>
<h2 style="margin:0 0 16px;font-size:18px">${esc(title)}</h2>
<table style="border-collapse:collapse;width:100%">${cells}</table>
${note ? `<p style="margin:16px 0 0;line-height:1.5">${esc(note)}</p>` : ""}
<p style="margin:20px 0 0"><a href="${appUrl()}${path}" style="color:#2563eb">Open it in the app</a></p>
<p style="margin:24px 0 0;color:#98a2b3;font-size:12px">Sent by the LAF Operating System on its schedule. Ask the Super Admin to change who receives it.</p>
</div>`;
}

/** The subject and body of a report for the month before `today` (or the year so far). Service role only. */
export async function buildReportEmail(admin: SupabaseClient, report: ReportKey, today: string): Promise<{ subject: string; html: string }> {
  const month = reportMonth(today);
  const ops = admin.schema("ops");

  if (report === "monthly_summary") {
    const year = Number(month.slice(0, 4));
    const { data: txns } = await ops.from("bank_transactions").select("posting_date, row_seq, debit, credit, running_balance, category").gte("posting_date", `${year}-01-01`).lte("posting_date", `${year}-12-31`);
    const { data: note } = await ops.from("finance_month_notes").select("drivers, confirmed_at").eq("month", month).maybeSingle();
    const rows: BankTxnLike[] = (txns ?? []).map((t) => ({ postingDate: t.posting_date, rowSeq: t.row_seq, debit: Number(t.debit), credit: Number(t.credit), runningBalance: Number(t.running_balance), category: t.category }));
    const row = monthlySummary(rows, year, {}).rows.find((r) => r.month === month)!;
    if (!row.hasData) return { subject: `Monthly Summary, ${monthName(month)}: statement not uploaded yet`, html: frame(`Monthly Summary, ${monthName(month)}`, [], "No bank statement covers this month yet, so there are no figures to send. Upload it under Financial › Bank import.", "/executive") };
    return {
      subject: `Monthly Summary, ${monthName(month)}`,
      html: frame(
        `Monthly Summary, ${monthName(month)}`,
        [
          ["Donations", peso(row.donation ?? 0)],
          ["Expenses", peso(row.expenses ?? 0)],
          ["Net", peso(row.net ?? 0)],
          ["Share of donations spent", row.pctSpent === null ? "—" : `${(row.pctSpent * 100).toFixed(1)}%`],
        ],
        note?.confirmed_at && note.drivers ? `Key monthly drivers: ${note.drivers}` : "The Key monthly drivers for this month are not confirmed yet.",
        "/executive"
      ),
    };
  }

  if (report === "programs") {
    const { data } = await ops.rpc("website_dashboard");
    const d = (data ?? {}) as { year?: number; ytd?: Record<string, number> };
    const y = d.ytd ?? {};
    const n = (k: string) => (y[k] ?? 0).toLocaleString("en-US");
    return {
      subject: `Programs report, ${d.year ?? today.slice(0, 4)} so far`,
      html: frame(
        `Programs report, ${d.year ?? today.slice(0, 4)} year to date`,
        [
          ["People housed (people-nights)", n("housing")],
          ["Meals served", n("meals")],
          ["Rides to and from the hospital", n("transportation")],
          ["Care Cart servings", n("care_cart")],
          ["LAF Center participants", n("center")],
        ],
        `The month-by-month figures, with what the app recorded beside what the sheets held, are on Reports › Programs.`,
        "/reports/programs"
      ),
    };
  }

  const { data: bill } = await ops.from("caf_billings").select("id, status, sent_at, paid_on").eq("month", month).maybeSingle();
  const { data: lines } = bill ? await ops.from("caf_billing_lines").select("nights").eq("billing_id", bill.id) : { data: [] as { nights: number }[] };
  const nights = (lines ?? []).reduce((s, l) => s + Number(l.nights ?? 0), 0);
  return {
    subject: `NCH bill, ${monthName(month)}: ${bill ? bill.status : "not started"}`,
    html: frame(
      `NCH Cancer Assistance Fund bill, ${monthName(month)}`,
      [
        ["Status", bill ? String(bill.status) : "Not started"],
        ["Children billed", String((lines ?? []).length)],
        ["Nights billed", String(nights)],
      ],
      bill ? "Check the nights, finalise the bill and send it to NCH from Reports › NCH Billing." : "This month's bill hasn't been started. Open Reports › NCH Billing to prepare it.",
      "/reports/caf-billing"
    ),
  };
}
