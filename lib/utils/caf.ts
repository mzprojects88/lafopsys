// NCH Cancer Assistance Fund billing (0098): the arithmetic of the September 2026 package.
// One night = one stay; the first `cap` nights of the month are billable; rate per stay; a PWD
// pays (100 - discount)%. Nothing here is stored: the bill is these numbers over its lines.
import { numberToWords } from "./amount-words.ts";

export interface CafTerms {
  rate: number;
  cap: number;
  discountPct: number;
}

export interface CafLineInput {
  nights: string[];
  pwd: boolean;
}

export interface CafAmounts {
  stays: number;
  /** The first `cap` nights, in order: these are listed on the Statement and the Letter. */
  billableNights: string[];
  billable: number;
  gross: number;
  discountPct: number;
  net: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function cafAmounts(line: CafLineInput, terms: CafTerms): CafAmounts {
  const nights = [...new Set(line.nights)].sort();
  const billableNights = nights.slice(0, terms.cap);
  const gross = round2(billableNights.length * terms.rate);
  const discountPct = line.pwd ? terms.discountPct : 0;
  return { stays: nights.length, billableNights, billable: billableNights.length, gross, discountPct, net: round2((gross * (100 - discountPct)) / 100) };
}

export function cafTotals(lines: CafLineInput[], terms: CafTerms) {
  const each = lines.map((l) => cafAmounts(l, terms));
  return {
    children: each.length,
    stays: each.reduce((s, a) => s + a.stays, 0),
    billable: each.reduce((s, a) => s + a.billable, 0),
    gross: round2(each.reduce((s, a) => s + a.gross, 0)),
    net: round2(each.reduce((s, a) => s + a.net, 0)),
  };
}

/** "ONE HUNDRED EIGHTY EIGHT THOUSAND PESOS ONLY", as the package writes amounts. */
export function pesosInWords(amount: number): string {
  const cents = Math.round(amount * 100);
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  const words = numberToWords(whole).replace(/-/g, " ").toUpperCase();
  return `${words} PESO${whole === 1 ? "" : "S"}${fraction ? ` AND ${String(fraction).padStart(2, "0")}/100` : ""} ONLY`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 2026" for a month's first day. */
export const cafMonthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** "Sep 1-30" for the Statement's period. */
export function cafPeriod(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${MONTHS[m - 1]} 1-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`;
}

/** "Sep 2" for a night. */
export const cafDay = (night: string) => `${MONTHS[Number(night.slice(5, 7)) - 1]} ${Number(night.slice(8, 10))}`;

/** Age in whole years on a day, from a birth date. */
export function ageOn(birthDate: string | null, day: string): number | null {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  return y! - by! - (m! < bm! || (m === bm && d! < bd!) ? 1 : 0);
}
