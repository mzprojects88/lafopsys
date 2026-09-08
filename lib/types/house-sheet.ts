/** One person on the house's Occupancy Tracker (ops.house_sheet_people, 0046). */
export type HouseSheetMatchStatus = "auto_matched" | "suggested" | "unmatched" | "confirmed" | "dismissed" | "encoded";
export type HouseSheetMatchMethod = "exact" | "loose" | "ai" | "manual";

export interface HouseSheetCandidate {
  id: string;
  name: string;
  patientNumber: string;
}

export interface HouseSheetPerson {
  id: string;
  nameKey: string;
  rowNo: number | null;
  patientName: string;
  carerName: string | null;
  relationship: string | null;
  nextAppointmentRaw: string | null;
  nextAppointmentOn: string | null;
  treatment: string | null;
  address: string | null;
  lafFlag: boolean;
  phone: string | null;
  firstSeenOn: string;
  lastSeenOn: string;
  daysSeen: number;
  offSheetAt: string | null;
  matchStatus: HouseSheetMatchStatus;
  matchedPatientId: string | null;
  matchMethod: HouseSheetMatchMethod | null;
  matchConfidence: number | null;
  aiCandidates: HouseSheetCandidate[];
  aiReason: string | null;
  aiError: string | null;
  aiAttempts: number;
  referralId: string | null;
  /** The patient a referral made from this row became, once admitted. */
  referralPatientId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  updatedAt: string;
}

/** The patient this row stands for, whichever way it got there. */
export function houseSheetPatientId(p: HouseSheetPerson): string | null {
  return p.matchedPatientId ?? p.referralPatientId;
}

export interface HouseSheetSyncRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "unchanged" | "failed";
  trigger: "cron" | "manual";
  triggeredBy: string | null;
  tabDate: string | null;
  rowsSeen: number;
  inserted: number;
  updated: number;
  offSheet: number;
  returned: number;
  autoMatched: number;
  suggested: number;
  unmatched: number;
  aiCalls: number;
  error: string | null;
}

export const HOUSE_SHEET_STATUS_LABELS: Record<HouseSheetMatchStatus, string> = {
  auto_matched: "Matched",
  suggested: "Suggested",
  unmatched: "Not found",
  confirmed: "Confirmed",
  dismissed: "Dismissed",
  encoded: "Encoded",
};
