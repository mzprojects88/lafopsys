"use server";

import { createClient } from "@/lib/supabase/server";
import { csvLines } from "@/lib/utils/csv";
import type { ActionResult } from "../actions";

/**
 * The government lists. They carry SSS, PhilHealth, Pag-IBIG numbers and
 * TINs from hr.employee_private, which never enters a client-side
 * collection -- so the CSVs are built here, as the signed-in HR person
 * under their own RLS, and handed back as text for the browser to save.
 *
 * Attribution: a month's figures are the settled payslips (run approved,
 * paid or closed) of the pay periods that START in that month; a year's
 * figures are the settled payslips of runs with that year.
 */

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

type Supabase = NonNullable<Awaited<ReturnType<typeof hrCaller>>["supabase"]>;

interface SlipRow {
  employee_id: string;
  basic_earned: string;
  gross: string;
  taxable_gross: string;
  non_taxable: string;
  taxable_income: string;
  tax_withheld: string;
  sss_ee: string;
  sss_er: string;
  ec: string;
  mpf_ee: string;
  mpf_er: string;
  philhealth_ee: string;
  philhealth_er: string;
  pagibig_ee: string;
  pagibig_er: string;
  lines: { code: string; kind: string; amount: number }[];
  payroll_runs: { status: string; kind: string; year: number };
  pay_periods: { starts_on: string } | null;
}

const SETTLED = ["approved", "paid", "closed"];
const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const money = (v: number) => v.toFixed(2);

async function settledSlips(supabase: Supabase, filter: { month?: string; year?: number }): Promise<SlipRow[]> {
  let q = supabase
    .schema("hr")
    .from("payslips")
    .select("employee_id, basic_earned, gross, taxable_gross, non_taxable, taxable_income, tax_withheld, sss_ee, sss_er, ec, mpf_ee, mpf_er, philhealth_ee, philhealth_er, pagibig_ee, pagibig_er, lines, payroll_runs!inner(status, kind, year), pay_periods(starts_on)")
    .in("payroll_runs.status", SETTLED);
  if (filter.year !== undefined) q = q.eq("payroll_runs.year", filter.year);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as SlipRow[];
  if (filter.month) return rows.filter((r) => r.pay_periods?.starts_on.startsWith(filter.month!));
  return rows;
}

interface Person {
  id: string;
  employee_code: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  birthdate: string | null;
  address: string | null;
  hire_date: string;
  separation_date: string | null;
  sss_no: string | null;
  philhealth_no: string | null;
  pagibig_no: string | null;
  tin: string | null;
}

async function people(supabase: Supabase, ids: string[]): Promise<Map<string, Person>> {
  if (ids.length === 0) return new Map();
  const [{ data: emps }, { data: priv }] = await Promise.all([
    supabase.schema("hr").from("employees").select("id, employee_code, last_name, first_name, middle_name, birthdate, address, hire_date, separation_date").in("id", ids),
    supabase.schema("hr").from("employee_private").select("employee_id, sss_no, philhealth_no, pagibig_no, tin").in("employee_id", ids),
  ]);
  const privBy = new Map((priv ?? []).map((p) => [p.employee_id as string, p]));
  return new Map(
    (emps ?? []).map((e) => {
      const p = privBy.get(e.id as string);
      return [e.id as string, { ...(e as Omit<Person, "sss_no" | "philhealth_no" | "pagibig_no" | "tin">), sss_no: p?.sss_no ?? null, philhealth_no: p?.philhealth_no ?? null, pagibig_no: p?.pagibig_no ?? null, tin: p?.tin ?? null }];
    })
  );
}

function sumBy(rows: SlipRow[]) {
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const t = out.get(r.employee_id) ?? {};
    for (const k of ["basic_earned", "gross", "taxable_gross", "non_taxable", "taxable_income", "tax_withheld", "sss_ee", "sss_er", "ec", "mpf_ee", "mpf_er", "philhealth_ee", "philhealth_er", "pagibig_ee", "pagibig_er"] as const) {
      t[k] = (t[k] ?? 0) + n(r[k]);
    }
    for (const l of r.lines ?? []) {
      if (l.code.startsWith("thirteenth_month")) t.thirteenth = (t.thirteenth ?? 0) + l.amount / 100;
      if (l.code === "thirteenth_month") t.thirteenth_exempt = (t.thirteenth_exempt ?? 0) + l.amount / 100;
    }
    out.set(r.employee_id, t);
  }
  return out;
}

const fullName = (p: Person) => `${p.last_name}, ${p.first_name}${p.middle_name ? ` ${p.middle_name}` : ""}`;

/** One month's SSS, PhilHealth or Pag-IBIG list, as the agency's columns want them. */
export async function remittanceListCsv(kind: "sss" | "philhealth" | "pagibig", month: string): Promise<ActionResult<{ csv: string; filename: string }>> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "Bad month." };
  const rows = await settledSlips(caller.supabase, { month });
  const totals = sumBy(rows);
  const who = await people(caller.supabase, [...totals.keys()]);
  const sorted = [...totals.entries()].sort((a, b) => (who.get(a[0])?.last_name ?? "").localeCompare(who.get(b[0])?.last_name ?? ""));
  let header: string[];
  let body: string[][];
  if (kind === "sss") {
    header = ["SSS No.", "Last name", "First name", "Middle name", "Employee ID", "SS EE", "SS ER", "EC", "MPF EE", "MPF ER", "Total"];
    body = sorted.map(([id, t]) => {
      const p = who.get(id);
      return [p?.sss_no ?? "", p?.last_name ?? "", p?.first_name ?? "", p?.middle_name ?? "", p?.employee_code ?? "", money(t.sss_ee), money(t.sss_er), money(t.ec), money(t.mpf_ee), money(t.mpf_er), money(t.sss_ee + t.sss_er + t.ec + t.mpf_ee + t.mpf_er)];
    });
  } else if (kind === "philhealth") {
    header = ["PhilHealth No.", "Last name", "First name", "Middle name", "Employee ID", "Basic salary", "EE share", "ER share", "Total"];
    body = sorted.map(([id, t]) => {
      const p = who.get(id);
      return [p?.philhealth_no ?? "", p?.last_name ?? "", p?.first_name ?? "", p?.middle_name ?? "", p?.employee_code ?? "", money(t.basic_earned), money(t.philhealth_ee), money(t.philhealth_er), money(t.philhealth_ee + t.philhealth_er)];
    });
  } else {
    header = ["Pag-IBIG MID No.", "Last name", "First name", "Middle name", "Employee ID", "EE share", "ER share", "Total"];
    body = sorted.map(([id, t]) => {
      const p = who.get(id);
      return [p?.pagibig_no ?? "", p?.last_name ?? "", p?.first_name ?? "", p?.middle_name ?? "", p?.employee_code ?? "", money(t.pagibig_ee), money(t.pagibig_er), money(t.pagibig_ee + t.pagibig_er)];
    });
  }
  return { ok: true, data: { csv: csvLines(header, body), filename: `${kind}-${month}.csv` } };
}

/**
 * The alphalist of employees for the year (1604-C Schedule 1 shape):
 * compensation, non-taxable, taxable, contributions, tax withheld per
 * person, with TIN. Everyone paid in the year, including the separated.
 */
export async function alphalistCsv(year: number): Promise<ActionResult<{ csv: string; filename: string }>> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  if (!Number.isInteger(year)) return { ok: false, error: "Bad year." };
  const rows = await settledSlips(caller.supabase, { year });
  const totals = sumBy(rows);
  const { data: openings } = await caller.supabase.schema("hr").from("ytd_openings").select("*").eq("year", year);
  for (const o of openings ?? []) {
    const t = totals.get(o.employee_id) ?? {};
    t.basic_earned = (t.basic_earned ?? 0) + n(o.basic_earned);
    t.taxable_income = (t.taxable_income ?? 0) + n(o.taxable_income);
    t.non_taxable = (t.non_taxable ?? 0) + n(o.non_taxable);
    t.tax_withheld = (t.tax_withheld ?? 0) + n(o.tax_withheld);
    t.sss_ee = (t.sss_ee ?? 0) + n(o.sss_ee);
    t.philhealth_ee = (t.philhealth_ee ?? 0) + n(o.philhealth_ee);
    t.pagibig_ee = (t.pagibig_ee ?? 0) + n(o.pagibig_ee);
    t.thirteenth_exempt = (t.thirteenth_exempt ?? 0) + n(o.thirteenth_month_paid);
    totals.set(o.employee_id, t);
  }
  const who = await people(caller.supabase, [...totals.keys()]);
  const sorted = [...totals.entries()].sort((a, b) => (who.get(a[0])?.last_name ?? "").localeCompare(who.get(b[0])?.last_name ?? ""));
  const header = ["Seq", "TIN", "Employee name (Last, First Middle)", "Employee ID", "Employed from", "Employed to", "Gross compensation", "13th month & other benefits (exempt)", "Other non-taxable", "SSS/PhilHealth/Pag-IBIG EE contributions", "Total non-taxable", "Taxable compensation", "Tax withheld"];
  const body = sorted.map(([id, t], i) => {
    const p = who.get(id);
    const contrib = (t.sss_ee ?? 0) + (t.mpf_ee ?? 0) + (t.philhealth_ee ?? 0) + (t.pagibig_ee ?? 0);
    const thirteenth = t.thirteenth_exempt ?? 0;
    const otherNonTax = Math.max(0, (t.non_taxable ?? 0) - thirteenth);
    const gross = (t.gross ?? 0) + (t.basic_earned && !t.gross ? t.basic_earned : 0);
    const from = p ? (p.hire_date > `${year}-01-01` ? p.hire_date : `${year}-01-01`) : "";
    const to = p?.separation_date && p.separation_date <= `${year}-12-31` ? p.separation_date : `${year}-12-31`;
    return [String(i + 1), p?.tin ?? "", p ? fullName(p) : id, p?.employee_code ?? "", from, to, money(gross), money(thirteenth), money(otherNonTax), money(contrib), money(thirteenth + otherNonTax + contrib), money(t.taxable_income ?? 0), money(t.tax_withheld ?? 0)];
  });
  return { ok: true, data: { csv: csvLines(header, body), filename: `alphalist-${year}.csv` } };
}
