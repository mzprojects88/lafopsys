"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, createCollectionFamily, useCollection } from "@/lib/data/collection-store";
import type { PayBasis, PayItem, PayItemCode, PayItemKind, PayrollRun, PayrollRunKind, PayrollRunStatus, Payslip, RateSnapshotEntry, YtdOpening } from "@/lib/types/hr";
import type { PayLine } from "@/lib/utils/payroll";

// PostgREST returns every numeric as a string; pesos are converted here, once.
const num = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const optNum = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

// --- Pay items --------------------------------------------------------------

interface PayItemRow {
  id: string;
  employee_id: string;
  kind: PayItemKind;
  code: PayItemCode;
  label: string;
  amount: string | number;
  period_id: string | null;
  is_recurring: boolean;
  starts_on: string | null;
  ends_on: string | null;
  amount_total: string | number | null;
  authorized_on: string | null;
  reference: string | null;
  de_minimis_kind: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export function toPayItem(r: PayItemRow): PayItem {
  return {
    id: r.id,
    employeeId: r.employee_id,
    kind: r.kind,
    code: r.code,
    label: r.label,
    amount: num(r.amount),
    periodId: r.period_id,
    isRecurring: r.is_recurring,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    amountTotal: optNum(r.amount_total),
    authorizedOn: r.authorized_on,
    reference: r.reference,
    deMinimisKind: r.de_minimis_kind,
    notes: r.notes,
    active: r.active,
    createdAt: r.created_at,
  };
}

/** Every pay item (HR) or the caller's own (RLS). A handful of rows. */
export const payItemsStore = createCollection<PayItem[]>({
  key: "hr.pay_items",
  empty: [],
  tables: [{ schema: "hr", table: "pay_items" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("pay_items").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as PayItemRow[]).map(toPayItem);
  },
});

export function usePayItems() {
  const { data: items, loading, error } = useCollection(payItemsStore);
  return { items, loading, error };
}

// --- Payroll runs -----------------------------------------------------------

interface PayrollRunRow {
  id: string;
  kind: PayrollRunKind;
  period_id: string | null;
  year: number;
  employee_id: string | null;
  status: PayrollRunStatus;
  label: string | null;
  computed_by: string | null;
  computed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_on: string | null;
  paid_by: string | null;
  paid_reference: string | null;
  totals: Record<string, unknown>;
  rate_snapshot: RateSnapshotEntry[];
  segregation_waiver: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function toPayrollRun(r: PayrollRunRow): PayrollRun {
  return {
    id: r.id,
    kind: r.kind,
    periodId: r.period_id,
    year: r.year,
    employeeId: r.employee_id,
    status: r.status,
    label: r.label,
    computedBy: r.computed_by,
    computedAt: r.computed_at,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    paidOn: r.paid_on,
    paidBy: r.paid_by,
    paidReference: r.paid_reference,
    totals: r.totals ?? {},
    rateSnapshot: r.rate_snapshot ?? [],
    segregationWaiver: r.segregation_waiver,
    cancelReason: r.cancel_reason,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Every run, newest first (HR only; RLS returns nothing to others). */
export const payrollRunsStore = createCollection<PayrollRun[]>({
  key: "hr.payroll_runs",
  empty: [],
  tables: [{ schema: "hr", table: "payroll_runs" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("payroll_runs").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as PayrollRunRow[]).map(toPayrollRun);
  },
});

export function usePayrollRuns() {
  const { data: runs, loading, error } = useCollection(payrollRunsStore);
  return { runs, loading, error };
}

// --- Payslips ----------------------------------------------------------------

interface PayslipRow {
  id: string;
  run_id: string;
  employee_id: string;
  period_id: string | null;
  pay_date: string;
  compensation_id: string | null;
  pay_basis: PayBasis;
  lines: PayLine[];
  basic_earned: string | number;
  gross: string | number;
  taxable_gross: string | number;
  non_taxable: string | number;
  taxable_income: string | number;
  total_deductions: string | number;
  net: string | number;
  tax_withheld: string | number;
  sss_ee: string | number;
  sss_er: string | number;
  ec: string | number;
  mpf_ee: string | number;
  mpf_er: string | number;
  philhealth_ee: string | number;
  philhealth_er: string | number;
  pagibig_ee: string | number;
  pagibig_er: string | number;
  employer_total: string | number;
  ytd: Record<string, number>;
  warnings: string[];
  acknowledged_at: string | null;
  bank_transaction_id: string | null;
  paid_reference: string | null;
  created_at: string;
}

export function toPayslip(r: PayslipRow): Payslip {
  return {
    id: r.id,
    runId: r.run_id,
    employeeId: r.employee_id,
    periodId: r.period_id,
    payDate: r.pay_date,
    compensationId: r.compensation_id,
    payBasis: r.pay_basis,
    lines: r.lines ?? [],
    basicEarned: num(r.basic_earned),
    gross: num(r.gross),
    taxableGross: num(r.taxable_gross),
    nonTaxable: num(r.non_taxable),
    taxableIncome: num(r.taxable_income),
    totalDeductions: num(r.total_deductions),
    net: num(r.net),
    taxWithheld: num(r.tax_withheld),
    sssEe: num(r.sss_ee),
    sssEr: num(r.sss_er),
    ec: num(r.ec),
    mpfEe: num(r.mpf_ee),
    mpfEr: num(r.mpf_er),
    philhealthEe: num(r.philhealth_ee),
    philhealthEr: num(r.philhealth_er),
    pagibigEe: num(r.pagibig_ee),
    pagibigEr: num(r.pagibig_er),
    employerTotal: num(r.employer_total),
    ytd: r.ytd ?? {},
    warnings: r.warnings ?? [],
    acknowledgedAt: r.acknowledged_at,
    bankTransactionId: r.bank_transaction_id,
    paidReference: r.paid_reference,
    createdAt: r.created_at,
  };
}

/** Per run: every payslip in it (HR). */
export const payslipsFamily = createCollectionFamily<Payslip[]>({
  key: "hr.payslips",
  empty: [],
  tables: () => [{ schema: "hr", table: "payslips" }],
  fetch: async (runId) => {
    const { data, error } = await createClient().schema("hr").from("payslips").select("*").eq("run_id", runId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as PayslipRow[]).map(toPayslip);
  },
});

export function useRunPayslips(runId: string | null) {
  const { data: payslips, loading, error } = useCollection(runId ? payslipsFamily.get(runId) : null);
  return { payslips, loading, error };
}

/** The caller's own payslips, newest first (RLS: own rows; HR sees everyone's, so the page filters). */
export const myPayslipsStore = createCollection<Payslip[]>({
  key: "hr.payslips:mine",
  empty: [],
  tables: [{ schema: "hr", table: "payslips" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("payslips").select("*").order("pay_date", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return ((data ?? []) as PayslipRow[]).map(toPayslip);
  },
});

export function usePayslips() {
  const { data: payslips, loading, error } = useCollection(myPayslipsStore);
  return { payslips, loading, error };
}

// --- YTD openings -------------------------------------------------------------

interface YtdOpeningRow {
  id: string;
  employee_id: string;
  year: number;
  as_of: string;
  basic_earned: string | number;
  taxable_income: string | number;
  non_taxable: string | number;
  tax_withheld: string | number;
  sss_ee: string | number;
  philhealth_ee: string | number;
  pagibig_ee: string | number;
  thirteenth_month_paid: string | number;
  source: string | null;
}

export function toYtdOpening(r: YtdOpeningRow): YtdOpening {
  return {
    id: r.id,
    employeeId: r.employee_id,
    year: r.year,
    asOf: r.as_of,
    basicEarned: num(r.basic_earned),
    taxableIncome: num(r.taxable_income),
    nonTaxable: num(r.non_taxable),
    taxWithheld: num(r.tax_withheld),
    sssEe: num(r.sss_ee),
    philhealthEe: num(r.philhealth_ee),
    pagibigEe: num(r.pagibig_ee),
    thirteenthMonthPaid: num(r.thirteenth_month_paid),
    source: r.source,
  };
}

export const ytdOpeningsStore = createCollection<YtdOpening[]>({
  key: "hr.ytd_openings",
  empty: [],
  tables: [{ schema: "hr", table: "ytd_openings" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("ytd_openings").select("*");
    if (error) throw new Error(error.message);
    return ((data ?? []) as YtdOpeningRow[]).map(toYtdOpening);
  },
});

export function useYtdOpenings() {
  const { data: openings, loading, error } = useCollection(ytdOpeningsStore);
  return { openings, loading, error };
}
