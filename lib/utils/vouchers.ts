/**
 * Payment requests and vouchers (0134), the pure parts: words for kinds and statuses, the step line a request
 * shows (who signed what, when, how long it took, who it waits for), and the amount a list shows when it is
 * filtered by a code. The database decides who may sign; nothing here does.
 */
export type VoucherKind = "reimbursement" | "cash_advance" | "supplier" | "petty_cash";
export type VoucherStatus = "draft" | "submitted" | "endorsed" | "prepared" | "reviewed" | "approved" | "returned" | "rejected" | "cancelled";
export type VoucherAction = "submit" | "skip_endorse" | "endorse" | "prepare" | "review" | "approve" | "return" | "reject" | "cancel" | "history";

export const KIND_LABEL: Record<VoucherKind, string> = {
  reimbursement: "Reimbursement (I paid)",
  cash_advance: "Cash advance (I need cash first)",
  supplier: "Pay a supplier",
  petty_cash: "Petty cash",
};
export const STATUS_LABEL: Record<VoucherStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for endorsement",
  endorsed: "With Finance",
  prepared: "Waiting for review",
  reviewed: "Waiting for approval",
  approved: "Approved",
  returned: "Sent back to the requester",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
export const PAY_LABEL: Record<string, string> = { cash: "Cash", check: "Check", bank_transfer: "Bank transfer", gcash: "GCash" };
/** Statuses still moving along the road (someone has to act). */
export const OPEN: readonly VoucherStatus[] = ["submitted", "endorsed", "prepared", "reviewed"];

/** The road, in order: the event that completes each step. */
const ROAD: { action: VoucherAction; label: string }[] = [
  { action: "submit", label: "Requested" },
  { action: "endorse", label: "Endorsed" },
  { action: "prepare", label: "Prepared by Finance" },
  { action: "review", label: "Reviewed" },
  { action: "approve", label: "Approved" },
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
 * current once it is approved, sent back, rejected or cancelled.
 */
export function trackSteps(status: VoucherStatus, events: readonly TrackEvent[], now: number): TrackStep[] {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const start = sorted.map((e) => e.action).lastIndexOf("submit");
  const round = start < 0 ? [] : sorted.slice(start);
  const steps: TrackStep[] = [];
  let previous: string | undefined;
  let waiting = OPEN.includes(status);
  for (const step of ROAD) {
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
