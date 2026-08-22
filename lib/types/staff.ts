import type { Role } from "@/lib/types/common";

export interface Staff {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
  position: string;
  photoUrl?: string;
  active: boolean;
  hireDate: string;
}

export interface Shift {
  id: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  label: "AM" | "PM" | "Night" | "24hr";
}

export type TimeEntryFlag = "on_time" | "late" | "early_out" | "missed_punch";

export interface TimeEntry {
  id: string;
  staffId: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
  breakMinutes: number;
  flag: TimeEntryFlag;
  overtimeMinutes: number;
  gpsStamped: boolean;
}

/** Why a punch has no address. Never inferred -- the capture path records which
 * of these actually happened, so a blank location is never ambiguous. */
export type PunchLocationStatus = "captured" | "permission_denied" | "unavailable" | "geocode_failed";

export type PunchDeviceType = "mobile" | "tablet" | "desktop" | "unknown";

/**
 * One clock-in or clock-out event. `TimeEntry` above is the *daily summary*
 * (one row per staff per day, overwritten on re-punch); this is the append-only
 * history behind it, and the only place location and device are recorded.
 */
export interface TimePunch {
  id: string;
  timeEntryId?: string;
  staffId: string;
  punchType: "clock_in" | "clock_out";
  /** ISO timestamp. */
  punchedAt: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  /** Full human-readable address. Undefined unless `locationStatus` is "captured". */
  addressLabel?: string;
  locationStatus: PunchLocationStatus;
  /** Public IP the punch arrived from. A browser cannot report a MAC address. */
  ipAddress?: string;
  userAgent?: string;
  deviceLabel?: string;
  deviceType: PunchDeviceType;
}

export type TimesheetStatus = "pending" | "approved" | "flagged" | "rejected";

export interface TimesheetApproval {
  id: string;
  timeEntryId: string;
  staffId: string;
  status: TimesheetStatus;
  adjustmentReason?: string;
  reviewedBy?: string;
}

export interface Volunteer {
  id: string;
  firstName: string;
  lastName: string;
  focusArea: "Care Cart" | "Activity Center" | "Transport" | "Events";
  totalHours: number;
  lastSessionDate: string;
  certificatesIssued: number;
}
