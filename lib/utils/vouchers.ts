/**
 * Payment requests and vouchers (0134), the pure parts: words for kinds and statuses, the step line a request
 * shows (who signed what, when, how long it took, who it waits for), and the amount a list shows when it is
 * filtered by a code. The database decides who may sign; nothing here does.
 */
import { dayKey } from "./dtr.ts";

export type VoucherKind = "reimbursement" | "cash_advance" | "supplier" | "petty_cash" | "fund_topup" | "liquidation";
export type VoucherStatus = "draft" | "submitted" | "endorsed" | "prepared" | "reviewed" | "approved" | "payment_prepared" | "payment_approved" | "released" | "returned" | "rejected" | "cancelled";
export type VoucherAction = "submit" | "skip_endorse" | "endorse" | "prepare" | "review" | "approve" | "prepare_payment" | "approve_payment" | "release" | "bank_match" | "return" | "reject" | "cancel" | "history";

export const KIND_LABEL: Record<VoucherKind, string> = {
  reimbursement: "Reimbursement (I paid)",
  cash_advance: "Cash advance (I need cash first)",
  supplier: "Pay a supplier",
  petty_cash: "Petty cash",
  fund_topup: "Fund top-up",
  liquidation: "Liquidation of an advance",
};
/** What a staff member picks on a new request (a top-up comes from its fund, a liquidation from its advance). */
export const REQUESTABLE: readonly VoucherKind[] = ["reimbursement", "cash_advance", "supplier", "petty_cash"];
export const STATUS_LABEL: Record<VoucherStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for endorsement",
  endorsed: "With Finance",
  prepared: "Waiting for review",
  reviewed: "Waiting for approval",
  approved: "Approved: payment to prepare",
  payment_prepared: "Payment waiting for approval",
  payment_approved: "Payment waiting for release",
  released: "Paid",
  returned: "Sent back to the requester",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
export const PAY_LABEL: Record<string, string> = { cash: "Cash", check: "Check", bank_transfer: "Bank transfer", gcash: "GCash" };
/** Statuses still moving along the road (someone has to act). */
export const OPEN: readonly VoucherStatus[] = ["submitted", "endorsed", "prepared", "reviewed", "approved", "payment_prepared", "payment_approved"];
/** Approved, whether paid yet or not (0139). */
export const APPROVED: readonly VoucherStatus[] = ["approved", "payment_prepared", "payment_approved", "released"];

/** The road, in order: the event that completes each step. */
const ROAD: { action: VoucherAction; label: string }[] = [
  { action: "submit", label: "Requested" },
  { action: "endorse", label: "Endorsed" },
  { action: "prepare", label: "Prepared by Finance" },
  { action: "review", label: "Reviewed" },
  { action: "approve", label: "Approved" },
  { action: "prepare_payment", label: "Payment prepared" },
  { action: "approve_payment", label: "Payment approved" },
  { action: "release", label: "Paid (released)" },
];

export interface TrackEvent {
  action: VoucherAction;
  at: string;
  actor: string | null;
  note: string | null;
}
export interface TrackStep {
  label: string;
  state: "done" | "skipped" | "current" | "todo";
  at?: string;
  actor?: string | null;
  /** How long the step took, from the step before it. */
  tookMs?: number;
  /** For the current step: how long it has waited. */
  waitingMs?: number;
}

/**
 * The step line, read from the events of the latest round (a request sent back and sent again starts the road
 * over; the earlier rounds stay in the full history). The step the request waits for is "current"; nothing is
 * current once it is paid, sent back, rejected or cancelled. A `direct` voucher (a slip paid from a fund, a
 * liquidation) is released straight after approval, without the two payment steps.
 */
export function trackSteps(status: VoucherStatus, events: readonly TrackEvent[], now: number, direct = false): TrackStep[] {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const start = sorted.map((e) => e.action).lastIndexOf("submit");
  const round = start < 0 ? [] : sorted.slice(start);
  const steps: TrackStep[] = [];
  let previous: string | undefined;
  let waiting = OPEN.includes(status);
  for (const step of ROAD.filter((s) => !direct || (s.action !== "prepare_payment" && s.action !== "approve_payment"))) {
    const done = round.find((e) => e.action === step.action || (step.action === "endorse" && e.action === "skip_endorse"));
    if (done) {
      steps.push({
        label: done.action === "skip_endorse" ? "Endorsement not needed" : step.label,
        state: done.action === "skip_endorse" ? "skipped" : "done",
        at: done.at,
        actor: done.actor,
        tookMs: previous ? Date.parse(done.at) - Date.parse(previous) : undefined,
      });
      previous = done.at;
    } else if (waiting) {
      steps.push({ label: step.label, state: "current", waitingMs: previous ? now - Date.parse(previous) : undefined });
      waiting = false;
    } else {
      steps.push({ label: step.label, state: "todo" });
    }
  }
  return steps;
}

/** "3 days", "5 hours", "under an hour". */
export function durationWords(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Statuses whose lines are spending: Finance has prepared the voucher (or it came from the registers so). */
export const SPENDING: readonly VoucherStatus[] = ["prepared", "reviewed", ...APPROVED];

/** Paid straight after approval (0139): a slip from a petty cash or GCash fund, or a liquidation. */
export const paidDirect = (v: { kind: VoucherKind; fundId: string | null }) => v.kind === "liquidation" || (!!v.fundId && v.kind !== "fund_topup");

type Counted = { id: string; kind: VoucherKind; status: VoucherStatus; advanceOf?: string | null; submittedAt: string | null; createdAt: string };

/** The advances whose liquidation Finance has prepared: from then on the liquidation's lines are the spending. */
export const settledAdvances = (vouchers: readonly Counted[]) =>
  new Set(vouchers.filter((v) => v.kind === "liquidation" && v.advanceOf && SPENDING.includes(v.status)).map((v) => v.advanceOf as string));

/**
 * The Manila day a voucher's spending counts on (budgets, goals, budget left): when Finance prepared it, else when
 * it was sent, else when it was made; null while it isn't spending (before preparing, or stopped), for a top-up
 * (it refills cash the slips already spent) and for an advance once its liquidation counts instead. One rule for
 * every screen.
 */
export function countedDay(v: Counted, preparedAt: string | undefined, settled: ReadonlySet<string>): string | null {
  if (v.kind === "fund_topup" || (v.kind === "cash_advance" && settled.has(v.id))) return null;
  return SPENDING.includes(v.status) ? dayKey(preparedAt ?? v.submittedAt ?? v.createdAt) : null;
}

/** What settling an advance leaves: the requester returns the change, or LAF reimburses the overspend. */
export function settlement(advanced: number, spent: number): { kind: "return" | "reimburse" | "even"; amount: number } {
  const d = Math.round((advanced - spent) * 100) / 100;
  return d > 0 ? { kind: "return", amount: d } : d < 0 ? { kind: "reimburse", amount: -d } : { kind: "even", amount: 0 };
}

/** The calendar quarter of a day, for the 2307 ("2026-Q4"), and its first and last days. */
export function quarterOf(day: string): { key: string; from: string; to: string } {
  const y = Number(day.slice(0, 4));
  const q = Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1;
  const last = new Date(Date.UTC(y, q * 3, 0)).getUTCDate();
  return { key: `${y}-Q${q}`, from: `${y}-${String(q * 3 - 2).padStart(2, "0")}-01`, to: `${y}-${String(q * 3).padStart(2, "0")}-${last}` };
}

/** Whole days a request has waited at its current step (0 on the day it arrived). */
export const daysWaiting = (since: string, now: number) => Math.max(0, Math.floor((now - Date.parse(since)) / 86_400_000));

/**
 * Whether a restricted fund may pay for an account: its list of codes or first digits, empty = any. The
 * database refuses the rest when Finance prepares the voucher (ops.voucher_prepare); this only warns earlier.
 */
export const fundAllows = (prefixes: readonly string[], code: string | null | undefined) =>
  prefixes.length === 0 || (!!code && prefixes.some((p) => code.startsWith(p)));

/** What a list shows for a request: its total, or with a code filter on, only the lines that match it. */
export function shownAmount<L extends { amount: number }>(total: number, lines: readonly L[], match: ((line: L) => boolean) | null): number {
  return match ? lines.filter(match).reduce((s, l) => s + l.amount, 0) : total;
}
