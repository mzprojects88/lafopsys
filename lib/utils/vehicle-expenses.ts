// The fuel and expense log's small rules (0077), pure so they run under node --test.
import { dayKey } from "./dtr.ts";

/** ₱ per litre, to the centavo; null without litres. */
export function pricePerLitre(amount: number, litres: number | null): number | null {
  if (!litres || litres <= 0) return null;
  return Math.round((amount / litres) * 100) / 100;
}

/** "₱1,234.50": costs keep their centavos (formatCurrency rounds to the peso). */
export function formatPesoCents(amount: number): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

/**
 * Who may change or void an entry, mirroring ops.guard_vehicle_expense: whoever logged it, the
 * same Manila day ("free"); after that the Super Admin, with a reason ("reason"); else "no".
 * A voided or posted entry stays as it is.
 */
export function changeRule(
  e: { loggedBy: string | null; loggedAt: string; voidedAt: string | null; posting?: unknown },
  me: string | null,
  isSuperAdmin: boolean,
  now: Date = new Date()
): "free" | "reason" | "no" {
  // Voided, or posted to Finance (0080): the cash entry is corrected there instead.
  if (e.voidedAt || e.posting) return "no";
  if (me && e.loggedBy === me && dayKey(e.loggedAt) === dayKey(now)) return "free";
  return isSuperAdmin ? "reason" : "no";
}
