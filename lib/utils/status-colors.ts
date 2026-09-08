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
  asset: {
    good: "positive",
    fair: "info",
    needs_repair: "warning",
    retired: "neutral",
    disposed: "neutral",
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
  pledge: {
    active: "positive",
    paused: "warning",
    cancelled: "neutral",
  },
  commitment: {
    pledged: "info",
    fulfilled: "positive",
    cancelled: "neutral",
  },
  donorAccount: {
    active: "positive",
    suspended: "negative",
  },
  // Google Sheet sync runs (0034).
  calendarSync: {
    running: "info",
    success: "positive",
    unchanged: "neutral",
    failed: "negative",
  },
  // HR (0036+): employee status, 201 documents, deadlines.
  employee: {
    active: "positive",
    on_leave: "info",
    resigned: "neutral",
    terminated: "negative",
    unlinked: "warning",
    probationary: "warning",
    regular: "positive",
    contractual: "info",
    part_time: "info",
    casual: "neutral",
  },
  document: {
    complete: "positive",
    submitted: "info",
    pending: "warning",
    for_renewal: "warning",
    expiring: "warning",
    expired: "negative",
    missing: "negative",
    not_applicable: "neutral",
  },
  deadline: {
    ok: "positive",
    due_soon: "warning",
    behind: "negative",
    overdue: "negative",
  },
  payPeriod: {
    open: "info",
    timesheets_approved: "warning",
    computed: "warning",
    approved: "positive",
    paid: "positive",
    closed: "neutral",
  },
  timesheet2: {
    draft: "neutral",
    approved: "positive",
    reopened: "warning",
  },
  payrollRun: {
    draft: "neutral",
    computed: "warning",
    approved: "positive",
    paid: "positive",
    closed: "neutral",
    cancelled: "negative",
  },
  payslip: {
    acknowledged: "positive",
    unacknowledged: "neutral",
    warning: "warning",
  },
  compliance: {
    due: "info",
    due_soon: "warning",
    overdue: "negative",
    in_progress: "warning",
    filed: "positive",
    late: "negative",
    na: "neutral",
  },
  attendance: {
    on_time: "positive",
    late: "warning",
    early_out: "warning",
    missed_punch: "negative",
    absent: "negative",
    rest_day: "neutral",
    holiday: "info",
    on_leave: "info",
    unscheduled: "neutral",
  },
  leave: {
    pending: "warning",
    approved: "positive",
    rejected: "negative",
    cancelled: "neutral",
  },
  holiday: {
    regular: "warning",
    special: "info",
    working: "neutral",
  },
  rateTable: {
    in_force: "positive",
    enjoined: "warning",
    draft: "neutral",
    superseded: "neutral",
  },
  // Master calendar venues (0032). Lower-cased at lookup; free text falls to neutral.
  venue: {
    laf: "positive",
    nch: "info",
    teams: "info",
    online: "info",
    other: "neutral",
    holiday: "warning",
  },
};

export function getStatusTone(domain: string, status: string): StatusTone {
  return STATUS_DOMAIN_MAP[domain]?.[status] ?? "neutral";
}
