/**
 * Semantic status palette on the design tokens (DESIGN.md: colour means
 * something). The spec has many multi-state lifecycles (AR, Donee Cert,
 * referrals, bed units, stock) that all reduce to the same five tones.
 */
export type StatusTone = "positive" | "info" | "warning" | "negative" | "neutral";

export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  positive: "bg-success/12 text-success-foreground dark:bg-success/15 dark:text-success",
  info: "bg-accent text-accent-foreground",
  warning: "bg-warning/12 text-warning-foreground dark:bg-warning/15 dark:text-warning",
  negative: "bg-destructive/10 text-destructive dark:bg-destructive/15",
  neutral: "bg-muted text-muted-foreground",
};

/** The same tones as plain text (figures, icons, inline notes). */
export const STATUS_TONE_TEXT: Record<StatusTone, string> = {
  positive: "text-success-foreground dark:text-success",
  info: "text-accent-foreground",
  warning: "text-warning-foreground dark:text-warning",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
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
    reserved: "neutral",
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
  // The house's Occupancy Tracker against patient records (0046).
  houseSheet: {
    auto_matched: "positive",
    confirmed: "positive",
    suggested: "info",
    unmatched: "warning",
    encoded: "info",
    dismissed: "neutral",
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
