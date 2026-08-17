import type { AppNotification, DocumentRecord, MetricSnapshot, ReportDefinition } from "@/lib/types/reports";
import { makeRng } from "@/lib/utils/seeded-random";
import realMetricSnapshots from "@/lib/mock-data/real/metric-snapshots.json";

const rng = makeRng(707);

export const reportDefinitions: ReportDefinition[] = [
  { id: "rpt-dswd-license", name: "DSWD Licensing Report", category: "DSWD", description: "Annual facility licensing compliance report", schedule: "annual", lastGeneratedAt: "2026-01-15" },
  { id: "rpt-dswd-caseload", name: "DSWD Caseload Inventory Report", category: "DSWD", description: "Annual caseload roster — religion, sector/case category, referral source, and social profile per patient", schedule: "annual" },
  { id: "rpt-dswd-psp", name: "DSWD Public Solicitation Report", category: "DSWD", description: "Permit DSWD-SB-PSP-S-2026-000125 solicitation summary", schedule: "quarterly", lastGeneratedAt: "2026-07-01" },
  { id: "rpt-bir-donee", name: "BIR Donee Certificate Register", category: "BIR", description: "Sequential donee certificate log for BIR", schedule: "monthly", lastGeneratedAt: "2026-07-31" },
  { id: "rpt-bir-summary", name: "BIR Donation Summary", category: "BIR", description: "Donation summary tied to BIR registration 601-322-056-00000", schedule: "monthly", lastGeneratedAt: "2026-07-31" },
  { id: "rpt-us-ack", name: "US Donor Acknowledgment Register", category: "US 501(c)(3)", description: "Acknowledgment receipt register for US donors", schedule: "monthly", lastGeneratedAt: "2026-07-31" },
  { id: "rpt-us-990", name: "Form 990 Support Schedules", category: "US 501(c)(3)", description: "Supporting schedules for annual Form 990 filing", schedule: "annual" },
  { id: "rpt-board-pack", name: "Monthly Board Pack", category: "Board", description: "Auto-assembled board reporting pack", schedule: "monthly", lastGeneratedAt: "2026-07-28" },
  { id: "rpt-grant-1", name: "Grant Report — Compassion Fund", category: "Grant", description: "Configurable period/metric grant report", schedule: "quarterly" },
  { id: "rpt-impact", name: "Impact Report (Deck)", category: "Impact", description: "Generated version of the impact presentation deck", schedule: "quarterly", lastGeneratedAt: "2026-06-30" },
];

export const documents: DocumentRecord[] = [
  { id: "doc-1", title: "DSWD License to Operate", category: "License", uploadedAt: "2026-01-10", uploadedBy: "Ana Del Mundo" },
  { id: "doc-2", title: "US 501(c)(3) Determination Letter", category: "Determination Letter", uploadedAt: "2018-03-01", uploadedBy: "Marivic Fortes-Bartolome" },
  { id: "doc-3", title: "Data Privacy Policy v2", category: "Policy", uploadedAt: "2026-05-20", uploadedBy: "Butch Bustamante" },
  { id: "doc-4", title: "NCH Referral MOA", category: "MOA", uploadedAt: "2022-09-01", uploadedBy: "Queen Izell Spencer" },
  { id: "doc-5", title: "Volunteer Code of Conduct", category: "Policy", uploadedAt: "2025-11-01", uploadedBy: "Ana Del Mundo" },
  { id: "doc-6", title: "DSWD Public Solicitation Permit 2026", category: "License", uploadedAt: "2026-01-05", uploadedBy: "Desiree Loquinario" },
];

export const notifications: AppNotification[] = [
  { id: "notif-1", title: "3 lots expiring within 14 days", body: "Egg (30/Tray) and Chicken lots are approaching expiry.", createdAt: rng.daysFromNow(0), read: false, kind: "expiry" },
  { id: "notif-2", title: "4 timesheets pending approval", body: "Late/early-out flags awaiting review.", createdAt: rng.daysFromNow(0), read: false, kind: "approval" },
  { id: "notif-3", title: "2 overdue check-outs", body: "Expected checkout date has passed for 2 stays.", createdAt: rng.daysFromNow(-1), read: false, kind: "overdue" },
  { id: "notif-4", title: "AR outstanding queue growing", body: "6 acknowledgment receipts still in draft.", createdAt: rng.daysFromNow(-1), read: true, kind: "approval" },
  { id: "notif-5", title: "Donee Cert pending release", body: "3 certificates approved and awaiting release.", createdAt: rng.daysFromNow(-2), read: true, kind: "approval" },
  { id: "notif-6", title: "Monthly close checklist due", body: "July close checklist has unchecked items.", createdAt: rng.daysFromNow(-3), read: true, kind: "system" },
];

const mockMetricSnapshots: MetricSnapshot[] = Array.from({ length: 12 }).map((_, m) => ({
  date: `2026-${String(m + 1).padStart(2, "0")}-01`,
  bedNights: rng.int(280, 420),
  meals: rng.int(700, 1100),
  trips: rng.int(60, 120),
  careCartMeals: rng.int(400, 900),
  activityParticipants: rng.int(30, 90),
  donationsYtd: (m + 1) * rng.int(120000, 180000),
}));

// Real monthly program metrics, synced from DATA/clean/metric-snapshots.json (see
// scripts/sync-real-data.mjs and scripts/clean-program-metrics.py). Only as many
// months as the source "Summary YTD" sheet has actually reported (currently
// Jan-Jun 2026) -- unreported months are left out entirely, not zero-filled.
// Falls back to 12 months of seeded mock data if that sync hasn't run.
export const metricSnapshots: MetricSnapshot[] =
  realMetricSnapshots.length > 0 ? (realMetricSnapshots as MetricSnapshot[]) : mockMetricSnapshots;
