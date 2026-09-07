/**
 * Philippine statutory deductions and the tables they are looked up in.
 *
 * Pure: the tables arrive as data (hr.rate_tables, 0037), nothing here knows
 * a date beyond the one it is handed, and every function is a lookup or a
 * formula the circular states. Rates as of 2026-09-08:
 *
 * - SSS: RA 11199 s.4(a), SSS Circular 2024-006 -- 15% of the monthly salary
 *   credit (employer 10%, employee 5%), MSC P5,000-P35,000 in P500 steps, the
 *   regular fund up to MSC P20,000 and the Mandatory Provident Fund (WISP)
 *   above it; Employees' Compensation P10 (MSC <= 14,500) or P30, employer
 *   only. A bracket table, not a formula, because the MSC is a step function
 *   of compensation.
 * - PhilHealth: RA 11223 s.10 -- 5% of basic monthly salary shared equally,
 *   floor P10,000, ceiling P100,000 (2024 onward, no suspension in 2026).
 * - Pag-IBIG: RA 9679, HDMF Circular 460 (Feb 2024) -- employee 1% when
 *   monthly compensation is P1,500 or less, otherwise 2%; employer 2%; the
 *   maximum fund salary is P10,000, so P200 each.
 * - Withholding tax: NIRC s.24(A)(2) as amended by TRAIN (RA 10963), revised
 *   withholding tables in RR 11-2018 Annex E for 2023 onward. Minimum wage
 *   earners are exempt (s.24(A)(2), RR 11-2018 s.2.78.1(B)(13)).
 * - De minimis benefits: RR 11-2018 s.2.78.1(A)(3) limits; the excess over a
 *   limit is taxable compensation (RR 8-2018), and together with 13th month
 *   and other benefits the P90,000 ceiling applies.
 *
 * Amounts are pesos with centavos, rounded half-up at two places.
 */

export type RateTableKind =
  | "sss"
  | "philhealth"
  | "pagibig"
  | "tax_semi_monthly"
  | "tax_monthly"
  | "tax_annual"
  | "minimum_wage";

export type RateTableStatus = "draft" | "in_force" | "enjoined" | "superseded";

/** A row of hr.rate_tables as the hook hands it over. */
export interface RateTableRow {
  id: string;
  kind: RateTableKind;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: RateTableStatus;
  source: string;
  params: Record<string, unknown>;
  rows: unknown[];
}

export interface SssBracket {
  /** Monthly compensation range this MSC applies to; `to` is exclusive. */
  from: number;
  to: number | null;
  msc: number;
  ee: number;
  er: number;
  ec: number;
  mpfEe: number;
  mpfEr: number;
}

export interface SssTable {
  kind: "sss";
  brackets: SssBracket[];
}

export interface PhilhealthTable {
  kind: "philhealth";
  rate: number;
  floor: number;
  ceiling: number;
}

export interface PagibigTable {
  kind: "pagibig";
  eeRateLow: number;
  lowThreshold: number;
  eeRate: number;
  erRate: number;
  maxFundSalary: number;
}

export interface TaxBracket {
  /** Tax = base + rate x (taxable - over) for the highest `over` <= taxable. */
  over: number;
  base: number;
  rate: number;
}

export interface TaxTable {
  kind: "tax_semi_monthly" | "tax_monthly" | "tax_annual";
  brackets: TaxBracket[];
}

export interface MinimumWageRow {
  region: string;
  sector: string;
  rate: number;
  wageOrder: string;
}

export interface MinimumWageTable {
  kind: "minimum_wage";
  effectiveFrom: string;
  status: RateTableStatus;
  rows: MinimumWageRow[];
}

export type RateTable = SssTable | PhilhealthTable | PagibigTable | TaxTable | MinimumWageTable;

export type RateTableFor<K extends RateTableKind> = K extends "sss"
  ? SssTable
  : K extends "philhealth"
    ? PhilhealthTable
    : K extends "pagibig"
      ? PagibigTable
      : K extends "minimum_wage"
        ? MinimumWageTable
        : TaxTable;

export function round2(n: number): number {
  // Half-up at two places, tolerant of binary noise (1.005 -> 1.01).
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, field: string): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${field} must be a number`);
  return n;
}

function optNum(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null;
  return num(v, field);
}

/**
 * Validates a table's params/rows and returns the typed table. Called by the
 * save action (so a typo in a bracket is refused, not silently mispriced) and
 * by the engine (so a stored table is trusted only after the same check).
 */
export function parseRateTable(row: Pick<RateTableRow, "kind" | "params" | "rows" | "effectiveFrom" | "status">): RateTable {
  const { kind, params, rows } = row;
  switch (kind) {
    case "sss": {
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("SSS table needs at least one bracket");
      const brackets = rows.map((r, i): SssBracket => {
        if (!isRecord(r)) throw new Error(`SSS bracket ${i + 1} is not an object`);
        const b = {
          from: num(r.from, `bracket ${i + 1} from`),
          to: optNum(r.to, `bracket ${i + 1} to`),
          msc: num(r.msc, `bracket ${i + 1} msc`),
          ee: num(r.ee, `bracket ${i + 1} ee`),
          er: num(r.er, `bracket ${i + 1} er`),
          ec: num(r.ec, `bracket ${i + 1} ec`),
          mpfEe: num(r.mpfEe ?? 0, `bracket ${i + 1} mpfEe`),
          mpfEr: num(r.mpfEr ?? 0, `bracket ${i + 1} mpfEr`),
        };
        if (b.to !== null && b.to <= b.from) throw new Error(`SSS bracket ${i + 1}: to must exceed from`);
        return b;
      });
      for (let i = 1; i < brackets.length; i++) {
        if (brackets[i - 1].to !== brackets[i].from) throw new Error(`SSS brackets ${i} and ${i + 1} do not join`);
      }
      if (brackets[brackets.length - 1].to !== null) throw new Error("The last SSS bracket must be open-ended (to = null)");
      return { kind, brackets };
    }
    case "philhealth": {
      const t: PhilhealthTable = {
        kind,
        rate: num(params.rate, "rate"),
        floor: num(params.floor, "floor"),
        ceiling: num(params.ceiling, "ceiling"),
      };
      if (t.rate <= 0 || t.rate >= 1) throw new Error("PhilHealth rate must be a fraction (0.05 for 5%)");
      if (t.ceiling < t.floor) throw new Error("PhilHealth ceiling must be at least the floor");
      return t;
    }
    case "pagibig": {
      const t: PagibigTable = {
        kind,
        eeRateLow: num(params.eeRateLow, "eeRateLow"),
        lowThreshold: num(params.lowThreshold, "lowThreshold"),
        eeRate: num(params.eeRate, "eeRate"),
        erRate: num(params.erRate, "erRate"),
        maxFundSalary: num(params.maxFundSalary, "maxFundSalary"),
      };
      for (const [k, v] of [
        ["eeRateLow", t.eeRateLow],
        ["eeRate", t.eeRate],
        ["erRate", t.erRate],
      ] as const) {
        if (v < 0 || v >= 1) throw new Error(`Pag-IBIG ${k} must be a fraction (0.02 for 2%)`);
      }
      return t;
    }
    case "tax_semi_monthly":
    case "tax_monthly":
    case "tax_annual": {
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("Tax table needs at least one bracket");
      const brackets = rows.map((r, i): TaxBracket => {
        if (!isRecord(r)) throw new Error(`Tax bracket ${i + 1} is not an object`);
        const b = { over: num(r.over, `bracket ${i + 1} over`), base: num(r.base, `bracket ${i + 1} base`), rate: num(r.rate, `bracket ${i + 1} rate`) };
        if (b.rate < 0 || b.rate >= 1) throw new Error(`Tax bracket ${i + 1}: rate must be a fraction`);
        return b;
      });
      for (let i = 1; i < brackets.length; i++) {
        if (brackets[i].over <= brackets[i - 1].over) throw new Error(`Tax brackets must be in ascending order of "over"`);
      }
      if (brackets[0].over !== 0) throw new Error("The first tax bracket must start at 0");
      return { kind, brackets };
    }
    case "minimum_wage": {
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("Minimum wage table needs at least one row");
      const out = rows.map((r, i): MinimumWageRow => {
        if (!isRecord(r)) throw new Error(`Minimum wage row ${i + 1} is not an object`);
        if (typeof r.region !== "string" || !r.region) throw new Error(`Minimum wage row ${i + 1} needs a region`);
        return {
          region: r.region,
          sector: typeof r.sector === "string" && r.sector ? r.sector : "non_agri",
          rate: num(r.rate, `row ${i + 1} rate`),
          wageOrder: typeof r.wageOrder === "string" ? r.wageOrder : "",
        };
      });
      return { kind, effectiveFrom: row.effectiveFrom, status: row.status, rows: out };
    }
  }
}

/**
 * The table in force on a date: the latest `effective_from` on or before it
 * with status `in_force`. Enjoined, draft and superseded versions never
 * price a payslip -- see NCR-27 in 0037.
 */
export function selectTable<K extends RateTableKind>(kind: K, date: string, tables: readonly RateTableRow[]): RateTableFor<K> {
  const candidates = tables
    .filter((t) => t.kind === kind && t.status === "in_force" && t.effectiveFrom <= date && (t.effectiveTo === null || t.effectiveTo > date))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
  const row = candidates[0];
  if (!row) throw new Error(`No ${kind} table in force on ${date}`);
  return parseRateTable(row) as RateTableFor<K>;
}

export interface SssContribution {
  msc: number;
  ee: number;
  er: number;
  ec: number;
  mpfEe: number;
  mpfEr: number;
  /** ee + mpfEe. */
  employeeTotal: number;
  /** er + ec + mpfEr. */
  employerTotal: number;
}

/** SSS on total monthly compensation (basic plus taxable allowances). */
export function sssContribution(monthlyCompensation: number, table: SssTable): SssContribution {
  const comp = Math.max(0, monthlyCompensation);
  const bracket = table.brackets.find((b) => comp >= b.from && (b.to === null || comp < b.to)) ?? table.brackets[0];
  return {
    msc: bracket.msc,
    ee: round2(bracket.ee),
    er: round2(bracket.er),
    ec: round2(bracket.ec),
    mpfEe: round2(bracket.mpfEe),
    mpfEr: round2(bracket.mpfEr),
    employeeTotal: round2(bracket.ee + bracket.mpfEe),
    employerTotal: round2(bracket.er + bracket.ec + bracket.mpfEr),
  };
}

/** PhilHealth on basic monthly salary, clamped to the floor and ceiling. */
export function philhealthPremium(basicMonthly: number, table: PhilhealthTable): { base: number; ee: number; er: number; total: number } {
  const base = Math.min(table.ceiling, Math.max(table.floor, Math.max(0, basicMonthly)));
  const total = round2(base * table.rate);
  const ee = round2(total / 2);
  return { base, ee, er: round2(total - ee), total };
}

/** Pag-IBIG on monthly compensation, capped at the maximum fund salary. */
export function pagibigContribution(monthlyCompensation: number, table: PagibigTable): { base: number; ee: number; er: number } {
  const comp = Math.max(0, monthlyCompensation);
  const base = Math.min(table.maxFundSalary, comp);
  const eeRate = comp <= table.lowThreshold ? table.eeRateLow : table.eeRate;
  return { base, ee: round2(base * eeRate), er: round2(base * table.erRate) };
}

/** Tax on a taxable amount for the table's own period (semi-monthly, monthly or annual). */
export function withholdingTax(taxable: number, table: TaxTable): number {
  if (taxable <= 0) return 0;
  let bracket = table.brackets[0];
  for (const b of table.brackets) {
    if (taxable > b.over) bracket = b;
  }
  if (taxable <= bracket.over) return 0;
  return round2(bracket.base + (taxable - bracket.over) * bracket.rate);
}

export const annualTax = withholdingTax;

/**
 * The statutory daily minimum wage in force for a region on a date, and
 * whether a later order exists that is not (yet) in force -- an enjoined
 * order means a wage differential may fall due retroactively if the
 * injunction is lifted (NCR-27, 2026).
 */
export function minimumWageAt(
  region: string,
  date: string,
  tables: readonly RateTableRow[],
  sector = "non_agri"
): { rate: number; wageOrder: string; effectiveFrom: string; pending: { rate: number; wageOrder: string; effectiveFrom: string; status: RateTableStatus } | null } {
  const parsed = tables
    .filter((t) => t.kind === "minimum_wage" && t.effectiveFrom <= date)
    .map((t) => parseRateTable(t) as MinimumWageTable)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
  const pick = (t: MinimumWageTable) => t.rows.find((r) => r.region === region && r.sector === sector);
  const inForce = parsed.find((t) => t.status === "in_force" && pick(t));
  if (!inForce) throw new Error(`No minimum wage in force for ${region} on ${date}`);
  const row = pick(inForce)!;
  const later = parsed.find((t) => t.status !== "in_force" && t.status !== "superseded" && t.effectiveFrom > inForce.effectiveFrom && pick(t));
  const laterRow = later ? pick(later)! : null;
  return {
    rate: row.rate,
    wageOrder: row.wageOrder,
    effectiveFrom: inForce.effectiveFrom,
    pending: later && laterRow ? { rate: laterRow.rate, wageOrder: laterRow.wageOrder, effectiveFrom: later.effectiveFrom, status: later.status } : null,
  };
}

/**
 * De minimis limits, RR 11-2018 s.2.78.1(A)(3) as amended. Amounts within the
 * limit are exempt from income tax and withholding; the excess is taxable
 * compensation. Keys are the `deMinimisKind` an allowance carries.
 */
export const DE_MINIMIS_LIMITS: Record<string, { label: string; perMonth?: number; perYear?: number }> = {
  rice: { label: "Rice subsidy", perMonth: 2000 },
  uniform: { label: "Uniform and clothing allowance", perYear: 6000 },
  laundry: { label: "Laundry allowance", perMonth: 300 },
  medical_dependents: { label: "Medical cash allowance to dependents", perMonth: 250 },
  medical: { label: "Actual medical assistance", perYear: 10000 },
  achievement: { label: "Employee achievement award (tangible)", perYear: 10000 },
  gifts: { label: "Gifts during Christmas and major anniversaries", perYear: 5000 },
  communication: { label: "Communication allowance (no de minimis limit; taxable unless for the employer's convenience)", perMonth: 0 },
};

/** Exempt portion of a de minimis allowance for one month, and the taxable excess. */
export function splitDeMinimis(kind: string | undefined, amountMonthly: number): { exempt: number; taxable: number } {
  const limit = kind ? DE_MINIMIS_LIMITS[kind] : undefined;
  if (!limit) return { exempt: 0, taxable: round2(amountMonthly) };
  const cap = limit.perMonth ?? (limit.perYear !== undefined ? limit.perYear / 12 : 0);
  const exempt = round2(Math.min(cap, Math.max(0, amountMonthly)));
  return { exempt, taxable: round2(Math.max(0, amountMonthly - exempt)) };
}

/** 13th month pay and other benefits are exempt up to this (NIRC s.32(B)(7)(e), TRAIN). */
export const THIRTEENTH_MONTH_EXEMPT_CEILING = 90000;

/**
 * The SSS bracket table from Circular 2024-006, generated rather than typed:
 * MSC 5,000 to 35,000 in 500 steps, the range for each MSC being MSC-250 to
 * MSC+250 (first from 0, last open), 5%/10% on the regular MSC up to 20,000
 * and on the MPF portion above it, EC 10 up to MSC 14,500 and 30 from 15,000.
 */
export function buildSssBrackets2025(): SssBracket[] {
  const out: SssBracket[] = [];
  for (let msc = 5000; msc <= 35000; msc += 500) {
    const regular = Math.min(msc, 20000);
    const mpf = msc - regular;
    out.push({
      from: msc === 5000 ? 0 : msc - 250,
      to: msc === 35000 ? null : msc + 250,
      msc,
      ee: round2(regular * 0.05),
      er: round2(regular * 0.1),
      ec: msc <= 14500 ? 10 : 30,
      mpfEe: round2(mpf * 0.05),
      mpfEr: round2(mpf * 0.1),
    });
  }
  return out;
}

/** RR 11-2018 Annex E, 2023 onward. */
export const TAX_BRACKETS_2023: Record<"tax_semi_monthly" | "tax_monthly" | "tax_annual", TaxBracket[]> = {
  tax_semi_monthly: [
    { over: 0, base: 0, rate: 0 },
    { over: 10417, base: 0, rate: 0.15 },
    { over: 16667, base: 937.5, rate: 0.2 },
    { over: 33333, base: 4270.7, rate: 0.25 },
    { over: 83333, base: 16770.7, rate: 0.3 },
    { over: 333333, base: 91770.7, rate: 0.35 },
  ],
  tax_monthly: [
    { over: 0, base: 0, rate: 0 },
    { over: 20833, base: 0, rate: 0.15 },
    { over: 33333, base: 1875, rate: 0.2 },
    { over: 66667, base: 8541.8, rate: 0.25 },
    { over: 166667, base: 33541.8, rate: 0.3 },
    { over: 666667, base: 183541.8, rate: 0.35 },
  ],
  tax_annual: [
    { over: 0, base: 0, rate: 0 },
    { over: 250000, base: 0, rate: 0.15 },
    { over: 400000, base: 22500, rate: 0.2 },
    { over: 800000, base: 102500, rate: 0.25 },
    { over: 2000000, base: 402500, rate: 0.3 },
    { over: 8000000, base: 2202500, rate: 0.35 },
  ],
};
