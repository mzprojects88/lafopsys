/**
 * Money for payroll: centavo integers, so that every line, subtotal and
 * total is exact and `gross - deductions = net` holds to the centavo.
 * Pesos come in from the compensation rows (numeric(12,2) as strings or
 * numbers) and go out to the payslip columns; everything in between is an
 * integer number of centavos.
 *
 * Rounding is half-up, once per line (rate x quantity x multiplier, then
 * round) -- the convention on a DOLE payroll register, and the only way a
 * printed line reproduces from its own rate and quantity.
 */

export type Centavos = number;

/** Half-up to the nearest integer; `Math.round` rounds -0.5 towards +0. */
export function roundHalfUp(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(n) + 0.5 + 1e-9);
}

export function roundHalfUp2(n: number): number {
  return roundHalfUp(n * 100) / 100;
}

/** Pesos (number or numeric string) to centavos. */
export function toCentavos(pesos: number | string | null | undefined): Centavos {
  if (pesos === null || pesos === undefined || pesos === "") return 0;
  const n = typeof pesos === "string" ? Number(pesos) : pesos;
  if (!Number.isFinite(n)) return 0;
  return roundHalfUp(n * 100);
}

export function fromCentavos(c: Centavos): number {
  return c / 100;
}

/** centavos x factor, half-up. The one multiplication the engine uses. */
export function mulC(c: Centavos, factor: number): Centavos {
  return roundHalfUp(c * factor);
}

/** Split a monthly amount into two cutoffs that sum exactly. */
export function halves(c: Centavos): [Centavos, Centavos] {
  const first = roundHalfUp(c / 2);
  return [first, c - first];
}

export function sumC(values: readonly Centavos[]): Centavos {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "₱12,345.67". Negative amounts print with a leading minus. */
export function formatPeso2(c: Centavos): string {
  const s = PESO.format(Math.abs(c) / 100);
  return c < 0 ? `-${s}` : s;
}

/** "12,345.67" for CSV and registers. */
export function formatAmount2(c: Centavos): string {
  const s = (Math.abs(c) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return c < 0 ? `-${s}` : s;
}
