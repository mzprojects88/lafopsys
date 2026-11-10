import type { Currency } from "@/lib/types/common";

/** Whole units for figures at a glance; `exact` keeps the centavos (vouchers and their lines, Nov 2026). */
export function formatCurrency(amount: number, currency: Currency = "PHP", exact = false) {
  return new Intl.NumberFormat(currency === "PHP" ? "en-PH" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: exact ? 2 : 0,
    maximumFractionDigits: exact ? 2 : 0,
  }).format(amount);
}

export function formatCompact(amount: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(amount);
}
