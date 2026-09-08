"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { minimumWageAt, selectTable, type RateTableRow } from "@/lib/utils/statutory";
import { computeDifferential, computeFinalPay, computePayslip, computeThirteenthMonth, rates, registerTotals, type PayItemLike, type PayslipComputation, type SeparationCause, type StatutoryTables, type YearToDate } from "@/lib/utils/payroll";
import { fromCentavos, halves, toCentavos } from "@/lib/utils/money";
import { serviceYears } from "@/lib/utils/employment";
import type { PeriodAttendance } from "@/lib/utils/attendance";
import { allowanceFromJson, type PayItemCode, type PayItemKind, type RateSnapshotEntry } from "@/lib/types/hr";
import type { ActionResult } from "../actions";

/** Same shape as app/(app)/hr/actions.ts hrCaller: RLS is the gate, this is the readable refusal. */
async function hrCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." as string, supabase: undefined, userId: undefined };
  const { data: staff } = await supabase.schema("shared").from("staff").select("role, is_hr, active").eq("id", user.id).single();
  if (!staff?.active || !(staff.role === "admin" || staff.is_hr)) return { error: "Only admins and HR can do this." as string, supabase: undefined, userId: undefined };
  return { error: undefined, supabase, userId: user.id };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const paths = () => {
  revalidatePath("/hr/payroll");
  revalidatePath("/hr/periods");
  revalidatePath("/hr");
};

// --- rate tables ------------------------------------------------------------------

interface RateTableDbRow {
  id: string;
  kind: RateTableRow["kind"];
  effective_from: string;
  effective_to: string | null;
  status: RateTableRow["status"];
  source: string;
  params: Record<string, unknown>;
  rows: unknown[];
}

const toRateTableRow = (r: RateTableDbRow): RateTableRow => ({ id: r.id, kind: r.kind, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, status: r.status, source: r.source, params: r.params, rows: r.rows });

/** The tables in force on the period's last day, and the snapshot that records which. */
function tablesFor(date: string, rows: RateTableRow[]): { tables: StatutoryTables; snapshot: RateSnapshotEntry[] } {
  const pick = <K extends RateTableRow["kind"]>(kind: K) => {
    const table = selectTable(kind, date, rows);
    const row = rows.filter((t) => t.kind === kind && t.status === "in_force" && t.effectiveFrom <= date).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0]!;
    return { table, entry: { kind, id: row.id, effectiveFrom: row.effectiveFrom, status: row.status } as RateSnapshotEntry };
  };
  const sss = pick("sss");
  const ph = pick("philhealth");
  const pi = pick("pagibig");
  const semi = pick("tax_semi_monthly");
  const annual = pick("tax_annual");
  return {
    tables: { sss: sss.table, philhealth: ph.table, pagibig: pi.table, taxSemiMonthly: semi.table, taxAnnual: annual.table },
    snapshot: [sss.entry, ph.entry, pi.entry, semi.entry, annual.entry],
  };
}

// --- compute ----------------------------------------------------------------------

type Supabase = NonNullable<Awaited<ReturnType<typeof hrCaller>>["supabase"]>;

interface PeriodRow {
  id: string;
  year: number;
  seq: number;
  starts_on: string;
  ends_on: string;
  pay_date: string;
  status: string;
}

interface Computed {
  employeeId: string;
  compensationId: string | null;
  payBasis: "monthly" | "daily";
  result: PayslipComputation;
  ytd: YearToDate;
}

type Skipped = { employeeId: string; employeeCode: string; reason: string };

const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

// Only approved or paid payslips count toward the year and loan balances.
type PriorSlip = { run_id: string; employee_id: string; period_id: string | null; pay_date: string; basic_earned: string; taxable_income: string; non_taxable: string; tax_withheld: string; sss_ee: string; mpf_ee: string; philhealth_ee: string; pagibig_ee: string; lines: { code?: string; payItemId?: string; kind: string; amount: number }[]; payroll_runs: { status: string; kind: string; year: number } };

/**
 * The year a payslip belongs to is its RUN's year, never its pay date:
 * the Dec 16-31 cutoff pays on Jan 5. Every year-to-date and every annual
 * report in the module uses the same rule. Settled = approved, paid, closed.
 */
async function settledSlipsOfYear(supabase: Supabase, year: number, excludeRunIds: readonly string[]): Promise<PriorSlip[]> {
  const { data } = await supabase
    .schema("hr")
    .from("payslips")
    .select("run_id, employee_id, period_id, pay_date, basic_earned, taxable_income, non_taxable, tax_withheld, sss_ee, mpf_ee, philhealth_ee, pagibig_ee, lines, payroll_runs!inner(status, kind, year)")
    .eq("payroll_runs.year", year);
  return ((data ?? []) as unknown as PriorSlip[]).filter((s) => !excludeRunIds.includes(s.run_id) && ["approved", "paid", "closed"].includes(s.payroll_runs.status));
}

function ytdFor(opening: Record<string, unknown> | undefined, slips: PriorSlip[]): YearToDate {
  const o = opening as Record<string, string | number | null> | undefined;
  return {
    basicEarned: n(o?.basic_earned) + slips.reduce((a, s) => a + n(s.basic_earned), 0),
    taxableIncome: n(o?.taxable_income) + slips.reduce((a, s) => a + n(s.taxable_income), 0),
    nonTaxable: n(o?.non_taxable) + slips.reduce((a, s) => a + n(s.non_taxable), 0),
    taxWithheld: n(o?.tax_withheld) + slips.reduce((a, s) => a + n(s.tax_withheld), 0),
    sssEe: n(o?.sss_ee) + slips.reduce((a, s) => a + n(s.sss_ee) + n(s.mpf_ee), 0),
    philhealthEe: n(o?.philhealth_ee) + slips.reduce((a, s) => a + n(s.philhealth_ee), 0),
    pagibigEe: n(o?.pagibig_ee) + slips.reduce((a, s) => a + n(s.pagibig_ee), 0),
    thirteenthMonthPaid: n(o?.thirteenth_month_paid) + slips.reduce((a, s) => a + (s.lines ?? []).filter((l) => l.code?.startsWith("thirteenth_month")).reduce((b, l) => b + l.amount, 0) / 100, 0),
  };
}

/**
 * The engine's input for one period, assembled as the caller: the people
 * due, their compensation in force, approved timesheet, pay items with an
 * open balance, the tables in force (and the snapshot recording which),
 * the minimum wage, and each person's year to date.
 */
async function computePeriodPayslips(
  supabase: Supabase,
  userId: string,
  period: PeriodRow,
  excludeRunIds: readonly string[],
  onlyEmployeeId: string | null,
  opts: { annualise?: boolean } = {}
): Promise<{ ok: true; computed: Computed[]; skipped: Skipped[]; snapshot: RateSnapshotEntry[] } | { ok: false; error: string }> {
  const periodId = period.id;
  const from = period.starts_on;
  const to = period.ends_on;
  const year = period.year;
  const isSecondCutoff = period.seq % 2 === 0;
  const isDecember = period.seq === 24;

  const [{ data: settings }, { data: tableRows }, { data: employees }, { data: comps }, { data: sheets }, { data: items }, { data: openings }, settled] = await Promise.all([
    supabase.schema("shared").from("app_settings").select("payroll_contribution_cutoff, minimum_wage_region").maybeSingle(),
    supabase.schema("hr").from("rate_tables").select("id, kind, effective_from, effective_to, status, source, params, rows"),
    supabase.schema("hr").from("employees").select("id, employee_code, hire_date, separation_date, status, staff_id"),
    supabase.schema("hr").from("compensation").select("id, employee_id, effective_from, effective_to, pay_basis, basic_monthly, daily_rate, days_factor, hours_per_day, allowances, is_minimum_wage_earner"),
    supabase.schema("hr").from("period_timesheets").select("employee_id, status, summary").eq("period_id", periodId),
    supabase.schema("hr").from("pay_items").select("*").eq("active", true),
    supabase.schema("hr").from("ytd_openings").select("*").eq("year", year),
    settledSlipsOfYear(supabase, year, excludeRunIds),
  ]);

  const rows = (tableRows ?? []).map((r) => toRateTableRow(r as RateTableDbRow));
  let tables: ReturnType<typeof tablesFor>;
  try {
    tables = tablesFor(to, rows);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No statutory tables in force." };
  }
  let minimumWageDaily: number | null = null;
  try {
    minimumWageDaily = minimumWageAt(settings?.minimum_wage_region ?? "NCR", to, rows).rate;
  } catch {
    minimumWageDaily = null;
  }
  const contributionCutoff = (settings?.payroll_contribution_cutoff as "second" | "split" | null) ?? "second";

  // The first cutoff of this month, for a daily-paid person's monthly contributions.
  const { data: firstCutoffPeriod } = isSecondCutoff ? await supabase.schema("hr").from("pay_periods").select("id").eq("year", year).eq("seq", period.seq - 1).maybeSingle() : { data: null };

  // A regular run pays the people employed in the period; a separated
  // person's last partial period is a final-pay run.
  const due = (employees ?? []).filter((e) =>
    onlyEmployeeId ? e.id === onlyEmployeeId : (e.status === "active" || e.status === "on_leave") && e.hire_date <= to && (e.separation_date === null || e.separation_date >= from)
  );
  const sheetBy = new Map((sheets ?? []).map((s) => [s.employee_id as string, s]));
  const openingBy = new Map((openings ?? []).map((o) => [o.employee_id as string, o]));

  const computed: Computed[] = [];
  const skipped: Skipped[] = [];

  for (const e of due) {
    const comp = (comps ?? [])
      .filter((c) => c.employee_id === e.id && c.effective_from <= to && (c.effective_to === null || c.effective_to > from))
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
    if (!comp) {
      skipped.push({ employeeId: e.id, employeeCode: e.employee_code, reason: "No compensation in force for this period" });
      continue;
    }
    const sheet = sheetBy.get(e.id);
    const attendance = sheet && sheet.status === "approved" && sheet.summary && "totals" in (sheet.summary as object) ? (sheet.summary as PeriodAttendance).totals : null;

    // Year to date: opening + settled payslips this year, up to this period.
    const mine = settled.filter((s) => s.employee_id === e.id && (s.period_id === null || s.pay_date <= period.pay_date));
    const ytd = ytdFor(openingBy.get(e.id), mine);

    // Pay items due this cutoff: one-off for this period, or recurring within its window, with the balance still open.
    const payItems: PayItemLike[] = [];
    for (const it of items ?? []) {
      if (it.employee_id !== e.id) continue;
      const inWindow = it.is_recurring ? (it.starts_on === null || it.starts_on <= to) && (it.ends_on === null || it.ends_on >= from) : it.period_id === periodId;
      if (!inWindow) continue;
      let remaining: number | null = null;
      if (it.amount_total !== null) {
        const applied = settled.reduce((a, s) => a + (s.lines ?? []).filter((l) => l.payItemId === it.id).reduce((b, l) => b + l.amount, 0), 0);
        remaining = Number(it.amount_total) - fromCentavos(applied);
        if (remaining <= 0) continue;
      }
      payItems.push({ id: it.id, kind: it.kind as PayItemKind, code: it.code as PayItemCode, label: it.label, amount: Number(it.amount), remaining, deMinimisKind: it.de_minimis_kind });
    }

    const firstSlip = firstCutoffPeriod ? settled.find((s) => s.employee_id === e.id && s.period_id === firstCutoffPeriod.id) : null;

    const result = computePayslip({
      period: { from, to, isSecondCutoff },
      comp: {
        payBasis: comp.pay_basis as "monthly" | "daily",
        basicMonthly: comp.basic_monthly,
        dailyRate: comp.daily_rate,
        daysFactor: comp.days_factor as 365 | 313 | 261,
        hoursPerDay: comp.hours_per_day,
        allowances: ((comp.allowances ?? []) as unknown[]).map(allowanceFromJson),
        isMinimumWageEarner: comp.is_minimum_wage_earner,
      },
      attendance,
      payItems,
      tables: tables.tables,
      minimumWageDaily,
      contributionCutoff,
      firstCutoff: firstSlip ? { basicEarned: Number(firstSlip.basic_earned), taxableGross: Number(firstSlip.taxable_income) } : null,
      ytd,
      // The year's tax is trued up on the last pay of the year (RR 11-2018 s.2.79(B)(5)): December's second cutoff, or a final pay whenever it falls.
      annualise: opts.annualise ?? (isDecember && isSecondCutoff),
    });
    if (e.staff_id === userId) result.warnings.push("approver_is_payee");
    computed.push({ employeeId: e.id, compensationId: comp.id, payBasis: comp.pay_basis as "monthly" | "daily", result, ytd });
  }
  return { ok: true, computed, skipped, snapshot: tables.snapshot };
}

/** A payslip row from the engine's output, pesos from centavos. */
function payslipRow(runId: string, periodId: string | null, payDate: string, c: Computed) {
  const p = fromCentavos;
  const r = c.result;
  return {
    run_id: runId,
    employee_id: c.employeeId,
    period_id: periodId,
    pay_date: payDate,
    compensation_id: c.compensationId,
    pay_basis: c.payBasis,
    lines: r.lines,
    basic_earned: p(r.basicEarned),
    gross: p(r.gross),
    taxable_gross: p(r.taxableGross),
    non_taxable: p(r.nonTaxable),
    taxable_income: p(r.taxableIncome),
    total_deductions: p(r.totalDeductions),
    net: p(r.net),
    tax_withheld: p(r.statutory.taxWithheld),
    sss_ee: p(r.statutory.sssEe),
    sss_er: p(r.statutory.sssEr),
    ec: p(r.statutory.ec),
    mpf_ee: p(r.statutory.mpfEe),
    mpf_er: p(r.statutory.mpfEr),
    philhealth_ee: p(r.statutory.philhealthEe),
    philhealth_er: p(r.statutory.philhealthEr),
    pagibig_ee: p(r.statutory.pagibigEe),
    pagibig_er: p(r.statutory.pagibigEr),
    employer_total: p(r.employerTotal),
    ytd: c.ytd,
    warnings: r.warnings,
  };
}

/** Writes a run's payslips and totals: replaces what is there (draft/computed only) and marks the run computed. */
async function writeRun(supabase: Supabase, userId: string, runId: string, periodId: string | null, payDate: string, computed: Computed[], skipped: Skipped[], snapshot: RateSnapshotEntry[]): Promise<string | null> {
  const { error: delErr } = await supabase.schema("hr").from("payslips").delete().eq("run_id", runId);
  if (delErr) return delErr.message;
  if (computed.length > 0) {
    const { error: insErr } = await supabase.schema("hr").from("payslips").insert(computed.map((c) => payslipRow(runId, periodId, payDate, c)));
    if (insErr) return insErr.message;
  }
  const totals = registerTotals(computed.map((c) => c.result));
  const totalsPesos = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, k === "count" ? v : fromCentavos(v)]));
  const { error: runErr } = await supabase
    .schema("hr")
    .from("payroll_runs")
    .update({ status: "computed", computed_by: userId, computed_at: new Date().toISOString(), totals: { ...totalsPesos, skipped }, rate_snapshot: snapshot })
    .eq("id", runId);
  return runErr ? runErr.message : null;
}

/**
 * Computes (or recomputes) the regular run for a period: one payslip per
 * employee with a compensation row in force, from their approved
 * timesheet, the pay items due, the tables in force and their year to
 * date. Creates the run when there is none; a run that is still draft or
 * computed is rewritten in place. Approved money is never touched.
 */
export async function computeRegularRun(periodId: string): Promise<ActionResult<{ runId: string; count: number; skipped: number }>> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase, userId } = caller;

  const { data: period } = await supabase.schema("hr").from("pay_periods").select("id, year, seq, starts_on, ends_on, pay_date, status").eq("id", periodId).single();
  if (!period) return { ok: false, error: "That period no longer exists." };
  if (period.status === "open") return { ok: false, error: "Mark the period's timesheets approved first (Timesheets page)." };
  if (period.status === "paid" || period.status === "closed") return { ok: false, error: "That period has been paid." };

  // December's second cutoff annualises the year, so the 13th month must be settled first.
  if (period.seq === 24) {
    const { data: pending } = await supabase.schema("hr").from("payroll_runs").select("id").eq("kind", "thirteenth_month").eq("year", period.year).in("status", ["draft", "computed"]).maybeSingle();
    if (pending) return { ok: false, error: "Approve (or cancel) the year's 13th month run before computing December's second cutoff: its annualisation needs it." };
  }

  // The run: reuse a live one, refuse if approved.
  const { data: live } = await supabase.schema("hr").from("payroll_runs").select("id, status").eq("period_id", periodId).eq("kind", "regular").neq("status", "cancelled").maybeSingle();
  if (live && live.status !== "draft" && live.status !== "computed") return { ok: false, error: "This period's run is approved; issue an adjustment run instead." };
  let runId = live?.id ?? null;
  if (!runId) {
    const { data: created, error } = await supabase.schema("hr").from("payroll_runs").insert({ kind: "regular", period_id: periodId, year: period.year, status: "draft", created_by: userId }).select("id").single();
    if (error || !created) return { ok: false, error: error?.message ?? "Could not create the run." };
    runId = created.id;
  }

  const r = await computePeriodPayslips(supabase, userId, period as PeriodRow, [runId], null);
  if (!r.ok) return r;
  const err = await writeRun(supabase, userId, runId, periodId, period.pay_date, r.computed, r.skipped, r.snapshot);
  if (err) return { ok: false, error: err };
  if (period.status !== "computed") await supabase.schema("hr").from("pay_periods").update({ status: "computed" }).eq("id", periodId);

  paths();
  return { ok: true, data: { runId, count: r.computed.length, skipped: r.skipped.length } };
}

/**
 * The year's 13th month (PD 851): total basic earned in the year / 12,
 * less what was paid in advance, for everyone employed. It is 1/12 of the
 * WHOLE calendar year's basic, and it is paid by Dec 24, so the cutoffs
 * not yet settled (December's, usually) are projected for a monthly-paid
 * person at half their basic each; the payslip carries an info line and a
 * `projected_basic` warning so the approver sees it. The exempt part
 * (within the 90,000 ceiling with other benefits) is non-taxable; the
 * excess is taxable compensation that December's annualisation picks up
 * -- which is why December's second cutoff waits for this run.
 */
export async function computeThirteenthMonthRun(year: number, payDate: string): Promise<ActionResult<{ runId: string; count: number }>> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase, userId } = caller;
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return { ok: false, error: "Year out of range." };
  if (!DATE_RE.test(payDate)) return { ok: false, error: "Give the pay date." };

  const { data: live } = await supabase.schema("hr").from("payroll_runs").select("id, status").eq("kind", "thirteenth_month").eq("year", year).neq("status", "cancelled").maybeSingle();
  if (live && live.status !== "draft" && live.status !== "computed") return { ok: false, error: `The ${year} 13th month run is already approved.` };
  let runId = live?.id ?? null;
  if (!runId) {
    const { data: created, error } = await supabase.schema("hr").from("payroll_runs").insert({ kind: "thirteenth_month", year, status: "draft", label: `13th month ${year}`, created_by: userId }).select("id").single();
    if (error || !created) return { ok: false, error: error?.message ?? "Could not create the run." };
    runId = created.id;
  }

  const [{ data: employees }, { data: comps }, { data: openings }, { data: periods }, settled] = await Promise.all([
    supabase.schema("hr").from("employees").select("id, employee_code, status, hire_date, separation_date"),
    supabase.schema("hr").from("compensation").select("id, employee_id, effective_from, effective_to, pay_basis, basic_monthly").is("effective_to", null),
    supabase.schema("hr").from("ytd_openings").select("*").eq("year", year),
    supabase.schema("hr").from("pay_periods").select("id, starts_on, ends_on").eq("year", year),
    settledSlipsOfYear(supabase, year, [runId]),
  ]);
  const openingBy = new Map((openings ?? []).map((o) => [o.employee_id as string, o]));
  const due = (employees ?? []).filter((e) => e.status === "active" || e.status === "on_leave");
  const computed: Computed[] = [];
  const skipped: Skipped[] = [];
  for (const e of due) {
    const comp = (comps ?? []).find((c) => c.employee_id === e.id);
    const mine = settled.filter((s) => s.employee_id === e.id);
    const opening = openingBy.get(e.id);
    const ytd = ytdFor(opening, mine);
    // Cutoffs of the year within this person's employment, after the opening figure, with no settled regular payslip: projected at half the monthly basic.
    const openingTo = (opening?.as_of as string | undefined) ?? "";
    const paidPeriods = new Set(mine.map((s) => s.period_id).filter((id): id is string => id !== null));
    const unpaid = comp && comp.pay_basis === "monthly" && comp.basic_monthly !== null ? (periods ?? []).filter((p) => p.starts_on > openingTo && p.ends_on >= e.hire_date && (e.separation_date === null || p.starts_on <= e.separation_date) && !paidPeriods.has(p.id)) : [];
    const projectedBasic = unpaid.length > 0 ? fromCentavos(halves(toCentavos(Number(comp!.basic_monthly)))[0] * unpaid.length) : 0;
    const t = computeThirteenthMonth({ basicEarnedYear: ytd.basicEarned, alreadyPaid: ytd.thirteenthMonthPaid, otherBenefitsYear: 0, projectedBasic, projectedCutoffs: unpaid.length });
    if (t.payable <= 0) {
      skipped.push({ employeeId: e.id, employeeCode: e.employee_code, reason: ytd.basicEarned + projectedBasic <= 0 ? "No basic salary earned this year" : "Already paid in full" });
      continue;
    }
    const result: PayslipComputation = {
      lines: t.lines,
      basicEarned: 0,
      gross: t.payable,
      taxableGross: t.taxable,
      nonTaxable: t.exempt,
      taxableIncome: t.taxable,
      totalDeductions: 0,
      net: t.payable,
      statutory: { sssEe: 0, sssEr: 0, ec: 0, mpfEe: 0, mpfEr: 0, philhealthEe: 0, philhealthEr: 0, pagibigEe: 0, pagibigEr: 0, taxWithheld: 0 },
      employerTotal: 0,
      warnings: unpaid.length > 0 ? ["projected_basic"] : [],
      rates: { monthly: 0, daily: 0, hourly: 0, hoursPerDay: 8 },
    };
    computed.push({ employeeId: e.id, compensationId: comp?.id ?? null, payBasis: (comp?.pay_basis as "monthly" | "daily") ?? "monthly", result, ytd });
  }
  const err = await writeRun(supabase, userId, runId, null, payDate, computed, skipped, []);
  if (err) return { ok: false, error: err };
  paths();
  return { ok: true, data: { runId, count: computed.length } };
}

export interface FinalPayInputForm {
  employeeId: string;
  payDate: string;
  /** Unused convertible VL days, from the leave page. */
  vlDays: number;
  /** Cash advances, unreturned property, pesos. */
  accountabilities: number;
  notes: string;
}

/**
 * Final pay for a separated person (DOLE LA 06-20: within 30 days): the
 * last partial period from its approved timesheet, the pro-rated 13th
 * month, VL conversion when the policy allows, separation pay by cause
 * (Arts. 298-299), less accountabilities. The year's tax is annualised
 * against the annual table because this is their last pay of the year
 * (when the last period was already paid by a regular run, that run's
 * withholding stands and nothing here is re-taxed). Known limit: the
 * taxable excess of the 13th month over 90,000 and of VL conversion over
 * 10 days is shown as taxable but not withheld on; HR withholds on the
 * final 1601-C by hand.
 */
export async function computeFinalPayRun(input: FinalPayInputForm): Promise<ActionResult<{ runId: string }>> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase, userId } = caller;
  if (!DATE_RE.test(input.payDate)) return { ok: false, error: "Give the pay date." };
  if (!(input.vlDays >= 0) || !(input.accountabilities >= 0)) return { ok: false, error: "Days and accountabilities cannot be negative." };

  const { data: e } = await supabase.schema("hr").from("employees").select("id, employee_code, status, hire_date, separation_date").eq("id", input.employeeId).single();
  if (!e) return { ok: false, error: "No such employee." };
  if ((e.status !== "resigned" && e.status !== "terminated") || !e.separation_date) return { ok: false, error: "Record the separation on the Employment tab first (the event sets the status and date)." };
  const { data: sep } = await supabase.schema("hr").from("employment_events").select("separation_cause").eq("employee_id", e.id).eq("kind", "separated").order("effective_on", { ascending: false }).limit(1).maybeSingle();
  const cause = (sep?.separation_cause as SeparationCause | null) ?? "resignation";
  const year = Number(e.separation_date.slice(0, 4));

  const { data: live } = await supabase.schema("hr").from("payroll_runs").select("id, status").eq("kind", "final_pay").eq("employee_id", e.id).neq("status", "cancelled").maybeSingle();
  if (live && live.status !== "draft" && live.status !== "computed") return { ok: false, error: "This person's final pay is already approved." };
  let runId = live?.id ?? null;
  if (!runId) {
    const { data: created, error } = await supabase.schema("hr").from("payroll_runs").insert({ kind: "final_pay", year, employee_id: e.id, status: "draft", label: `Final pay ${e.employee_code}`, notes: input.notes.trim() || null, created_by: userId }).select("id").single();
    if (error || !created) return { ok: false, error: error?.message ?? "Could not create the run." };
    runId = created.id;
  }

  // The last period: the one containing the separation date.
  const { data: period } = await supabase.schema("hr").from("pay_periods").select("id, year, seq, starts_on, ends_on, pay_date, status").lte("starts_on", e.separation_date).gte("ends_on", e.separation_date).maybeSingle();
  if (!period) return { ok: false, error: "No pay period covers the separation date; generate the year's periods first." };
  const { data: paidAlready } = await supabase.schema("hr").from("payslips").select("id, payroll_runs!inner(status, kind)").eq("employee_id", e.id).eq("period_id", period.id).neq("run_id", runId);
  const alreadyInRegular = (paidAlready ?? []).some((s) => ["approved", "paid", "closed"].includes((s.payroll_runs as unknown as { status: string }).status));

  const r = await computePeriodPayslips(supabase, userId, period as PeriodRow, [runId], e.id, { annualise: !alreadyInRegular });
  if (!r.ok) return r;
  const c = r.computed[0];
  if (!c) return { ok: false, error: r.skipped[0]?.reason ?? "Nothing to compute." };

  // The last partial period: nothing at all if a regular run already paid it (its contributions and tax stand there).
  const zeroStatutory: PayslipComputation["statutory"] = { sssEe: 0, sssEr: 0, ec: 0, mpfEe: 0, mpfEr: 0, philhealthEe: 0, philhealthEr: 0, pagibigEe: 0, pagibigEr: 0, taxWithheld: 0 };
  if (alreadyInRegular) c.result = { ...c.result, lines: [], basicEarned: 0, gross: 0, taxableGross: 0, nonTaxable: 0, taxableIncome: 0, totalDeductions: 0, net: 0, statutory: zeroStatutory, employerTotal: 0 };
  const last = c.result;
  const settled = await settledSlipsOfYear(supabase, year, [runId]);
  const { data: opening } = await supabase.schema("hr").from("ytd_openings").select("*").eq("year", year).eq("employee_id", e.id).maybeSingle();
  const ytd = ytdFor(opening ?? undefined, settled.filter((s) => s.employee_id === e.id));
  const thirteenth = computeThirteenthMonth({ basicEarnedYear: ytd.basicEarned + (alreadyInRegular ? 0 : fromCentavos(c.result.basicEarned)), alreadyPaid: ytd.thirteenthMonthPaid, otherBenefitsYear: 0 });
  const { data: settings } = await supabase.schema("shared").from("app_settings").select("leave_vl_convertible").maybeSingle();
  const { data: comp } = await supabase.schema("hr").from("compensation").select("*").eq("id", c.compensationId!).single();
  const rt = rates({ payBasis: comp!.pay_basis, basicMonthly: comp!.basic_monthly, dailyRate: comp!.daily_rate, daysFactor: comp!.days_factor, hoursPerDay: comp!.hours_per_day, allowances: [], isMinimumWageEarner: comp!.is_minimum_wage_earner });
  const final = computeFinalPay({
    lastPayslip: last,
    thirteenth,
    vlDays: settings?.leave_vl_convertible === false ? 0 : input.vlDays,
    dailyRate: rt.daily / 100,
    monthlyRate: rt.monthly / 100,
    cause,
    serviceYears: serviceYears(e.hire_date, e.separation_date),
    accountabilities: input.accountabilities,
  });
  const nonTaxable = final.lines.filter((l) => l.kind === "earning" && !l.taxable).reduce((a, l) => a + l.amount, 0);
  const result: PayslipComputation = {
    ...c.result,
    lines: final.lines,
    gross: final.gross,
    taxableGross: final.gross - nonTaxable,
    nonTaxable,
    totalDeductions: final.totalDeductions,
    net: final.net,
    warnings: c.result.warnings,
  };
  const err = await writeRun(supabase, userId, runId, period.id, input.payDate, [{ ...c, result, ytd }], [], r.snapshot);
  if (err) return { ok: false, error: err };
  paths();
  return { ok: true, data: { runId } };
}

/**
 * An adjustment run for a period whose regular run is approved: every
 * payslip recomputed with today's compensation rows and tables (a wage
 * order lifted from enjoined, a corrected rate), and only the DIFFERENCE
 * paid, as lines on a new run. The baseline is everything already settled
 * for the period (the regular run AND earlier adjustments), so a second
 * adjustment pays only what the first did not. The originals stay as they
 * were approved.
 */
export async function computeAdjustmentRun(periodId: string, reason: string): Promise<ActionResult<{ runId: string; count: number }>> {
  if (!reason.trim()) return { ok: false, error: "Say what changed." };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase, userId } = caller;
  const { data: period } = await supabase.schema("hr").from("pay_periods").select("id, year, seq, starts_on, ends_on, pay_date, status").eq("id", periodId).single();
  if (!period) return { ok: false, error: "That period no longer exists." };
  const { data: regular } = await supabase.schema("hr").from("payroll_runs").select("id, status").eq("period_id", periodId).eq("kind", "regular").in("status", ["approved", "paid", "closed"]).maybeSingle();
  if (!regular) return { ok: false, error: "Only a period whose regular run is approved can be adjusted." };
  const { data: live } = await supabase.schema("hr").from("payroll_runs").select("id, status").eq("period_id", periodId).eq("kind", "adjustment").in("status", ["draft", "computed"]).maybeSingle();
  let runId = live?.id ?? null;
  if (!runId) {
    const { data: created, error } = await supabase.schema("hr").from("payroll_runs").insert({ kind: "adjustment", period_id: periodId, year: period.year, status: "draft", label: `Adjustment: ${reason.trim()}`, notes: reason.trim(), created_by: userId }).select("id").single();
    if (error || !created) return { ok: false, error: error?.message ?? "Could not create the run." };
    runId = created.id;
  }
  const { data: originals } = await supabase
    .schema("hr")
    .from("payslips")
    .select("run_id, employee_id, lines, payroll_runs!inner(status, kind)")
    .eq("period_id", periodId)
    .neq("run_id", runId)
    .in("payroll_runs.status", ["approved", "paid", "closed"])
    .neq("payroll_runs.kind", "final_pay");
  const originalBy = new Map<string, PayslipComputation["lines"]>();
  const baselineRuns = new Set<string>([regular.id]);
  for (const o of originals ?? []) {
    baselineRuns.add(o.run_id as string);
    originalBy.set(o.employee_id as string, [...(originalBy.get(o.employee_id as string) ?? []), ...((o.lines ?? []) as PayslipComputation["lines"])]);
  }
  // Recompute against everything settled EXCEPT this period's runs, so the diff is against a clean year.
  const r = await computePeriodPayslips(supabase, userId, period as PeriodRow, [...baselineRuns], null);
  if (!r.ok) return r;
  const computed: Computed[] = [];
  for (const c of r.computed) {
    const diff = computeDifferential(originalBy.get(c.employeeId) ?? [], c.result.lines);
    if (diff.length === 0) continue;
    const earnings = diff.filter((l) => l.kind === "earning");
    const gross = earnings.reduce((a, l) => a + l.amount, 0);
    const nonTaxable = earnings.filter((l) => !l.taxable).reduce((a, l) => a + l.amount, 0);
    const deductions = diff.filter((l) => l.kind === "deduction").reduce((a, l) => a + l.amount, 0);
    const get = (code: string) => diff.find((l) => l.code === code)?.amount ?? 0;
    computed.push({
      ...c,
      result: {
        ...c.result,
        lines: diff,
        basicEarned: get("basic") + get("absence") + get("tardiness") + get("undertime") + get("unpaid_leave"),
        gross,
        taxableGross: gross - nonTaxable,
        nonTaxable,
        taxableIncome: 0,
        totalDeductions: deductions,
        net: gross - deductions,
        statutory: { sssEe: get("sss_ee"), sssEr: get("sss_er"), ec: get("ec"), mpfEe: get("mpf_ee"), mpfEr: get("mpf_er"), philhealthEe: get("philhealth_ee"), philhealthEr: get("philhealth_er"), pagibigEe: get("pagibig_ee"), pagibigEr: get("pagibig_er"), taxWithheld: get("tax") - get("tax_refund") },
        employerTotal: diff.filter((l) => l.kind === "employer").reduce((a, l) => a + l.amount, 0),
      },
    });
  }
  const err = await writeRun(supabase, userId, runId, periodId, period.pay_date, computed, r.skipped, r.snapshot);
  if (err) return { ok: false, error: err };
  paths();
  return { ok: true, data: { runId, count: computed.length } };
}

/** Approves a computed run. The database refuses when approver = computer unless a waiver is given. */
export async function approvePayrollRun(runId: string, waiver: string | null): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase, userId } = caller;
  const { data: run } = await supabase.schema("hr").from("payroll_runs").select("status, period_id, computed_by").eq("id", runId).single();
  if (!run) return { ok: false, error: "That run no longer exists." };
  if (run.status !== "computed") return { ok: false, error: "Only a computed run can be approved." };
  const { error } = await supabase
    .schema("hr")
    .from("payroll_runs")
    .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString(), segregation_waiver: waiver?.trim() || null })
    .eq("id", runId);
  if (error) return { ok: false, error: error.code === "42501" ? "You computed this run. Ask the other admin to approve it, or give a waiver reason." : error.message };
  if (run.period_id) await supabase.schema("hr").from("pay_periods").update({ status: "approved" }).eq("id", run.period_id);
  paths();
  return { ok: true };
}

/** Records that the net amounts were transferred: the date and the bank's reference. */
export async function markPayrollRunPaid(runId: string, input: { paidOn: string; reference: string }): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase, userId } = caller;
  if (!DATE_RE.test(input.paidOn)) return { ok: false, error: "Give the date the transfers were made." };
  const { data: run } = await supabase.schema("hr").from("payroll_runs").select("status, period_id").eq("id", runId).single();
  if (!run) return { ok: false, error: "That run no longer exists." };
  if (run.status !== "approved") return { ok: false, error: "Only an approved run can be marked paid." };
  const { error } = await supabase
    .schema("hr")
    .from("payroll_runs")
    .update({ status: "paid", paid_on: input.paidOn, paid_by: userId, paid_reference: input.reference.trim() || null })
    .eq("id", runId);
  if (error) return { ok: false, error: error.message };
  if (input.reference.trim()) await supabase.schema("hr").from("payslips").update({ paid_reference: input.reference.trim() }).eq("run_id", runId);
  if (run.period_id) await supabase.schema("hr").from("pay_periods").update({ status: "paid" }).eq("id", run.period_id);
  paths();
  return { ok: true };
}

/** Cancels a run that has not been approved; the period goes back to timesheets_approved. */
export async function cancelPayrollRun(runId: string, reason: string): Promise<ActionResult> {
  if (!reason.trim()) return { ok: false, error: "Say why the run is cancelled." };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase } = caller;
  const { data: run } = await supabase.schema("hr").from("payroll_runs").select("status, period_id").eq("id", runId).single();
  if (!run) return { ok: false, error: "That run no longer exists." };
  if (run.status !== "draft" && run.status !== "computed") return { ok: false, error: "An approved run cannot be cancelled; issue an adjustment run." };
  await supabase.schema("hr").from("payslips").delete().eq("run_id", runId);
  const { error } = await supabase.schema("hr").from("payroll_runs").update({ status: "cancelled", cancel_reason: reason.trim() }).eq("id", runId);
  if (error) return { ok: false, error: error.message };
  if (run.period_id) await supabase.schema("hr").from("pay_periods").update({ status: "timesheets_approved" }).eq("id", run.period_id);
  paths();
  return { ok: true };
}

// --- pay items ----------------------------------------------------------------------

export interface PayItemInput {
  employeeId: string;
  kind: PayItemKind;
  code: PayItemCode;
  label: string;
  amount: number;
  periodId: string | null;
  isRecurring: boolean;
  startsOn: string | null;
  endsOn: string | null;
  amountTotal: number | null;
  authorizedOn: string | null;
  reference: string;
  deMinimisKind: string | null;
  notes: string;
}

export async function savePayItem(id: string | null, input: PayItemInput): Promise<ActionResult<{ id: string }>> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase, userId } = caller;
  if (!input.label.trim()) return { ok: false, error: "Give the item a label." };
  if (!(input.amount > 0)) return { ok: false, error: "The amount must be more than zero." };
  if (input.kind === "deduction" && !input.authorizedOn) return { ok: false, error: "A deduction needs the date the person authorised it in writing (Art. 113)." };
  if (input.isRecurring && input.periodId) return { ok: false, error: "A recurring item has no single period." };
  if (!input.isRecurring && !input.periodId) return { ok: false, error: "Choose the period a one-off item lands in." };
  if (input.amountTotal !== null && input.amountTotal < input.amount) return { ok: false, error: "The balance cannot be less than one instalment." };
  const row = {
    employee_id: input.employeeId,
    kind: input.kind,
    code: input.code,
    label: input.label.trim(),
    amount: input.amount,
    period_id: input.isRecurring ? null : input.periodId,
    is_recurring: input.isRecurring,
    starts_on: input.isRecurring ? input.startsOn : null,
    ends_on: input.isRecurring ? input.endsOn : null,
    amount_total: input.amountTotal,
    authorized_on: input.authorizedOn,
    reference: input.reference.trim() || null,
    de_minimis_kind: input.code === "de_minimis" ? input.deMinimisKind : null,
    notes: input.notes.trim() || null,
  };
  if (id) {
    const { error } = await supabase.schema("hr").from("pay_items").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    paths();
    return { ok: true, data: { id } };
  }
  const { data, error } = await supabase.schema("hr").from("pay_items").insert({ ...row, created_by: userId }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save." };
  paths();
  return { ok: true, data: { id: data.id } };
}

export async function setPayItemActive(id: string, active: boolean): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { error } = await caller.supabase.schema("hr").from("pay_items").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  paths();
  return { ok: true };
}

// --- YTD openings ------------------------------------------------------------------

export interface YtdOpeningInput {
  employeeId: string;
  year: number;
  asOf: string;
  basicEarned: number;
  taxableIncome: number;
  nonTaxable: number;
  taxWithheld: number;
  sssEe: number;
  philhealthEe: number;
  pagibigEe: number;
  thirteenthMonthPaid: number;
  source: string;
}

/** The year's figures paid before the system: upserted per employee and year. */
export async function saveYtdOpening(input: YtdOpeningInput): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  if (!DATE_RE.test(input.asOf)) return { ok: false, error: "Give the date the figures run to." };
  const { supabase, userId } = caller;
  const { error } = await supabase
    .schema("hr")
    .from("ytd_openings")
    .upsert(
      {
        employee_id: input.employeeId,
        year: input.year,
        as_of: input.asOf,
        basic_earned: input.basicEarned,
        taxable_income: input.taxableIncome,
        non_taxable: input.nonTaxable,
        tax_withheld: input.taxWithheld,
        sss_ee: input.sssEe,
        philhealth_ee: input.philhealthEe,
        pagibig_ee: input.pagibigEe,
        thirteenth_month_paid: input.thirteenthMonthPaid,
        source: input.source.trim() || null,
        created_by: userId,
      },
      { onConflict: "employee_id,year" }
    );
  if (error) return { ok: false, error: error.message };
  paths();
  return { ok: true };
}

// --- the employee's one write ------------------------------------------------------

/** Marks the caller's own payslip as seen. RLS + the guard trigger make sure nothing else changes. */
export async function acknowledgePayslip(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { error } = await supabase.schema("hr").from("payslips").update({ acknowledged_at: new Date().toISOString() }).eq("id", id).is("acknowledged_at", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/payslips");
  return { ok: true };
}

// --- bank reconciliation -------------------------------------------------------------

/**
 * Links a settled payslip to the bank statement line that paid it (0033).
 * The guard trigger allows exactly this on an approved payslip. Null
 * unlinks. Paid runs write nothing to ops.cash_entries -- the bank row is
 * the cleared money the finance summary already counts.
 */
export async function linkPayslipBankTransaction(payslipId: string, bankTransactionId: string | null): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase } = caller;
  if (bankTransactionId) {
    const { data: tx } = await supabase.schema("ops").from("bank_transactions").select("id, debit").eq("id", bankTransactionId).maybeSingle();
    if (!tx) return { ok: false, error: "That bank line is not visible to you (finance and admins read the statement)." };
    if (Number(tx.debit) <= 0) return { ok: false, error: "A salary payment is a debit on the statement." };
    const { data: taken } = await supabase.schema("hr").from("payslips").select("id").eq("bank_transaction_id", bankTransactionId).neq("id", payslipId).maybeSingle();
    if (taken) return { ok: false, error: "That bank line is already linked to another payslip." };
  }
  const { error } = await supabase.schema("hr").from("payslips").update({ bank_transaction_id: bankTransactionId }).eq("id", payslipId);
  if (error) return { ok: false, error: error.code === "42501" ? "Only a settled payslip can be linked." : error.message };
  revalidatePath("/hr/payroll/reconcile");
  return { ok: true };
}
