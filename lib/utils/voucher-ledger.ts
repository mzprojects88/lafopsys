/**
 * Financial › Ledger (0140), the pure parts: the stage a request or voucher is at, the day it counts on for the
 * chosen date, and the totals of a set of coded items. The page filters and groups; nothing here reads data.
 */
import { dayKey } from "./dtr.ts";
import { APPROVED, type VoucherAction, type VoucherStatus } from "./vouchers.ts";

export type Stage = "payment_request" | "approved_request" | "payment_voucher" | "approved_voucher" | "paid" | "stopped";
/** The stages in order (decided 12 Nov 2026: Paid on its own after Approved Voucher). */
export const STAGES: { key: Stage; label: string }[] = [
  { key: "payment_request", label: "Payment Request" },
  { key: "approved_request", label: "Approved Request" },
  { key: "payment_voucher", label: "Payment Voucher" },
  { key: "approved_voucher", label: "Approved Voucher" },
  { key: "paid", label: "Paid" },
  { key: "stopped", label: "Rejected or cancelled" },
];
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<Stage, string>;

/** Where a request is: sent (or sent back), endorsed and with Finance, a numbered voucher waiting for approval,
 * approved (its payment on the way), paid; stopped when rejected or cancelled; null for a draft (not sent). */
export function stageOf(status: VoucherStatus): Stage | null {
  switch (status) {
    case "submitted":
    case "returned":
      return "payment_request";
    case "endorsed":
      return "approved_request";
    case "prepared":
    case "reviewed":
      return "payment_voucher";
    case "approved":
    case "payment_prepared":
    case "payment_approved":
      return "approved_voucher";
    case "released":
      return "paid";
    case "rejected":
    case "cancelled":
      return "stopped";
    default:
      return null;
  }
}

export type Basis = "requested" | "voucher" | "approved" | "paid";
export const BASIS_LABEL: Record<Basis, string> = { requested: "Requested on", voucher: "Voucher date", approved: "Approved on", paid: "Paid on" };

/**
 * The Manila day a request counts on for a basis, or null when it hasn't got there (not approved, not paid). The
 * voucher date falls back to the day it was sent while Finance hasn't prepared it. A voucher from the registers was
 * "sent" on its register date and paid on its paid day; one approved without an approver's name counts on its
 * register date. Corrections (history events) never move a date.
 */
export function ledgerDay(
  basis: Basis,
  v: { status: VoucherStatus; submittedAt: string | null; createdAt: string; releasedAt: string | null },
  events: readonly { action: VoucherAction; at: string }[]
): string | null {
  const last = (action: VoucherAction) => events.filter((e) => e.action === action).map((e) => e.at).sort().at(-1);
  const sent = v.submittedAt ?? v.createdAt;
  const at =
    basis === "requested" ? sent
    : basis === "voucher" ? (last("prepare") ?? sent)
    : basis === "approved" ? (last("approve") ?? (APPROVED.includes(v.status) ? sent : null))
    : (v.releasedAt ?? null);
  return at ? dayKey(at) : null;
}

/** Gross, withheld and net of a set of items. */
export function ledgerTotals(items: readonly { amount: number; ewtAmount: number }[]): { gross: number; ewt: number; net: number } {
  const round = (n: number) => Math.round(n * 100) / 100;
  const gross = round(items.reduce((s, l) => s + l.amount, 0));
  const ewt = round(items.reduce((s, l) => s + l.ewtAmount, 0));
  return { gross, ewt, net: round(gross - ewt) };
}
