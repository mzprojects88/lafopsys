"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { minimumWageAt, selectTable, type RateTableRow } from "@/lib/utils/statutory";
import { computePayslip, registerTotals, type PayItemLike, type PayslipComputation, type StatutoryTables, type YearToDate } from "@/lib/utils/payroll";
import { fromCentavos } from "@/lib/utils/money";
import type { PeriodAttendance } from "@/lib/utils/attendance";
import type { PayItemCode, PayItemKind, RateSnapshotEntry } from "@/lib/types/hr";
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

  // The run: reuse a live one, refuse if approved.
  const { data: live } = await supabase.schema("hr").from("payroll_runs").select("id, status").eq("period_id", periodId).eq("kind", "regular").neq("status", "cancelled").maybeSingle();
  if (live && live.status !== "draft" && live.status !== "computed") return { ok: false, error: "This period's run is approved; issue an adjustment run instead." };
  let runId = live?.id ?? null;
  if (!runId) {
    const { data: created, error } = await supabase.schema("hr").from("payroll_runs").insert({ kind: "regular", period_id: periodId, year: period.year, status: "draft", created_by: userId }).select("id").single();
    if (error || !created) return { ok: false, error: error?.message ?? "Could not create the run." };
    runId = created.id;
  }

  const from = period.starts_on as string;
  const to = period.ends_on as string;
  const year = period.year as number;
  const isSecondCutoff = (period.seq as number) % 2 === 0;
  const isDecember = (period.seq as number) === 24;

  const [{ data: settings }, { data: tableRows }, { data: employees }, { data: comps }, { data: sheets }, { data: items }, { data: openings }, { data: priorSlips }] = await Promise.all([
    supabase.schema("shared").from("app_settings").select("payroll_contribution_cutoff, minimum_wage_region").maybeSingle(),
    supabase.schema("hr").from("rate_tables").select("id, kind, effective_from, effective_to, status, source, params, rows"),
    supabase.schema("hr").from("employees").select("id, employee_code, hire_date, separation_date, status, staff_id"),
    supabase.schema("hr").from("compensation").select("id, employee_id, effective_from, effective_to, pay_basis, basic_monthly, daily_rate, days_factor, hours_per_day, allowances, is_minimum_wage_earner"),
    supabase.schema("hr").from("period_timesheets").select("employee_id, status, summary").eq("period_id", periodId),
    supabase.schema("hr").from("pay_items").select("*").eq("active", true),
    supabase.schema("hr").from("ytd_openings").select("*").eq("year", year),
    supabase
      .schema("hr")
      .from("payslips")
      .select("employee_id, period_id, pay_date, basic_earned, taxable_income, non_taxable, tax_withheld, sss_ee, mpf_ee, philhealth_ee, pagibig_ee, lines, payroll_runs!inner(status, kind)")
      .gte("pay_date", `${year}-01-01`)
      .lte("pay_date", `${year}-12-31`)
      .neq("run_id", runId),
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

  // Only approved or paid payslips count toward the year and loan balances.
  type PriorSlip = { employee_id: string; period_id: string | null; pay_date: string; basic_earned: string; taxable_income: string; non_taxable: string; tax_withheld: string; sss_ee: string; mpf_ee: string; philhealth_ee: string; pagibig_ee: string; lines: { payItemId?: string; kind: string; amount: number }[]; payroll_runs: { status: string; kind: string } };
  const settled = ((priorSlips ?? []) as unknown as PriorSlip[]).filter((s) => ["approved", "paid", "closed"].includes(s.payroll_runs.status));

  // The first cutoff of this month, for a daily-paid person's monthly contributions.
  const { data: firstCutoffPeriod } = isSecondCutoff ? await supabase.schema("hr").from("pay_periods").select("id").eq("year", year).eq("seq", (period.seq as number) - 1).maybeSingle() : { data: null };

  const due = (employees ?? []).filter((e) => e.hire_date <= to && (e.separation_date === null || e.separation_date >= from) && e.status !== "terminated");
  const sheetBy = new Map((sheets ?? []).map((s) => [s.employee_id as string, s]));
  const openingBy = new Map((openings ?? []).map((o) => [o.employee_id as string, o]));

  const computed: { employeeId: string; compensationId: string; payBasis: "monthly" | "daily"; result: PayslipComputation; ytd: YearToDate }[] = [];
  const skipped: { employeeId: string; employeeCode: string; reason: string }[] = [];

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

    // Year to date: opening + settled payslips this year, before this period.
    const mine = settled.filter((s) => s.employee_id === e.id && s.pay_date < (period.pay_date as string));
    const o = openingBy.get(e.id);
    const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
    const ytd: YearToDate = {
      basicEarned: n(o?.basic_earned) + mine.reduce((a, s) => a + n(s.basic_earned), 0),
      taxableIncome: n(o?.taxable_income) + mine.reduce((a, s) => a + n(s.taxable_income), 0),
      nonTaxable: n(o?.non_taxable) + mine.reduce((a, s) => a + n(s.non_taxable), 0),
      taxWithheld: n(o?.tax_withheld) + mine.reduce((a, s) => a + n(s.tax_withheld), 0),
      sssEe: n(o?.sss_ee) + mine.reduce((a, s) => a + n(s.sss_ee) + n(s.mpf_ee), 0),
      philhealthEe: n(o?.philhealth_ee) + mine.reduce((a, s) => a + n(s.philhealth_ee), 0),
      pagibigEe: n(o?.pagibig_ee) + mine.reduce((a, s) => a + n(s.pagibig_ee), 0),
      thirteenthMonthPaid: n(o?.thirteenth_month_paid),
    };

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
        allowances: (comp.allowances ?? []) as { code: string; label: string; amountMonthly: number; tax: "taxable" | "de_minimis"; deMinimisKind?: string }[],
        isMinimumWageEarner: comp.is_minimum_wage_earner,
      },
      attendance,
      payItems,
      tables: tables.tables,
      minimumWageDaily,
      contributionCutoff,
      firstCutoff: firstSlip ? { basicEarned: Number(firstSlip.basic_earned), taxableGross: Number(firstSlip.taxable_income) } : null,
      ytd,
      annualise: isDecember && isSecondCutoff,
    });
    if (e.staff_id === userId) result.warnings.push("approver_is_payee");
    computed.push({ employeeId: e.id, compensationId: comp.id, payBasis: comp.pay_basis as "monthly" | "daily", result, ytd });
  }

  // Write: replace the run's payslips (still draft/computed, so the delete policy allows it).
  const { error: delErr } = await supabase.schema("hr").from("payslips").delete().eq("run_id", runId);
  if (delErr) return { ok: false, error: delErr.message };
  if (computed.length > 0) {
    const p = fromCentavos;
    const rowsToInsert = computed.map(({ employeeId, compensationId, payBasis, result, ytd }) => ({
      run_id: runId,
      employee_id: employeeId,
      period_id: periodId,
      pay_date: period.pay_date,
      compensation_id: compensationId,
      pay_basis: payBasis,
      lines: result.lines,
      basic_earned: p(result.basicEarned),
      gross: p(result.gross),
      taxable_gross: p(result.taxableGross),
      non_taxable: p(result.nonTaxable),
      taxable_income: p(result.taxableIncome),
      total_deductions: p(result.totalDeductions),
      net: p(result.net),
      tax_withheld: p(result.statutory.taxWithheld),
      sss_ee: p(result.statutory.sssEe),
      sss_er: p(result.statutory.sssEr),
      ec: p(result.statutory.ec),
      mpf_ee: p(result.statutory.mpfEe),
      mpf_er: p(result.statutory.mpfEr),
      philhealth_ee: p(result.statutory.philhealthEe),
      philhealth_er: p(result.statutory.philhealthEr),
      pagibig_ee: p(result.statutory.pagibigEe),
      pagibig_er: p(result.statutory.pagibigEr),
      employer_total: p(result.employerTotal),
      ytd,
      warnings: result.warnings,
    }));
    const { error: insErr } = await supabase.schema("hr").from("payslips").insert(rowsToInsert);
    if (insErr) return { ok: false, error: insErr.message };
  }

  const totals = registerTotals(computed.map((c) => c.result));
  const totalsPesos = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, k === "count" ? v : fromCentavos(v)]));
  const { error: runErr } = await supabase
    .schema("hr")
    .from("payroll_runs")
    .update({ status: "computed", computed_by: userId, computed_at: new Date().toISOString(), totals: { ...totalsPesos, skipped }, rate_snapshot: tables.snapshot })
    .eq("id", runId);
  if (runErr) return { ok: false, error: runErr.message };
  if (period.status !== "computed") await supabase.schema("hr").from("pay_periods").update({ status: "computed" }).eq("id", periodId);

  paths();
  return { ok: true, data: { runId, count: computed.length, skipped: skipped.length } };
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
