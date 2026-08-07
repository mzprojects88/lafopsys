/**
 * Semantic status palette, independent of shadcn's default badge colors.
 * The spec has many multi-state lifecycles (AR, Donee Cert, referrals,
 * bed units, stock) that all reduce to the same five tones.
 */
export type StatusTone = "positive" | "info" | "warning" | "negative" | "neutral";

export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  positive: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  info: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  negative: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  neutral: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400",
};

/** domain -> status value -> tone. Add a domain here whenever a new state machine appears. */
export const STATUS_DOMAIN_MAP: Record<string, Record<string, StatusTone>> = {
  patient: {
    ongoing: "info",
    check_up: "info",
    completed: "positive",
    expired: "negative",
    lost_to_follow_up: "warning",
    non_pedia: "neutral",
  },
  stay: {
    in_house: "info",
    checked_out: "positive",
    overdue: "negative",
  },
  referral: {
    submitted: "neutral",
    approved: "positive",
    waitlisted: "warning",
    declined: "negative",
    admitted: "info",
  },
  unit: {
    available: "positive",
    occupied: "info",
    maintenance: "warning",
    blocked: "negative",
  },
  ar: {
    draft: "neutral",
    issued: "info",
    sent: "info",
    acknowledged: "positive",
  },
  doneeCert: {
    requested: "neutral",
    prepared: "info",
    approved: "info",
    released: "positive",
    filed: "positive",
  },
  stock: {
    ok: "positive",
    low: "warning",
    reorder: "warning",
    out: "negative",
  },
  expiry: {
    fresh: "positive",
    soon60: "warning",
    soon30: "warning",
    soon14: "negative",
    expired: "negative",
  },
  timesheet: {
    pending: "neutral",
    approved: "positive",
    flagged: "warning",
    rejected: "negative",
  },
  finance: {
    pending: "neutral",
    approved: "positive",
    rejected: "negative",
  },
  trip: {
    scheduled: "neutral",
    in_progress: "info",
    completed: "positive",
  },
};

export function getStatusTone(domain: string, status: string): StatusTone {
  return STATUS_DOMAIN_MAP[domain]?.[status] ?? "neutral";
}
