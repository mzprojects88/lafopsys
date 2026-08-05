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
