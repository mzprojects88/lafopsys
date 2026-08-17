import type { Currency, Entity } from "@/lib/types/common";

export type CashEntryDirection = "inflow" | "outflow";

export type CashEntrySource =
  | "cash_donation"
  | "in_kind_donation"
  | "capital_infusion"
  | "inter_entity_transfer"
  | "grant"
  | "fundraising_event"
  | "interest"
  | "program_expense"
  | "payroll"
  | "rent_utilities"
  | "vehicle_fuel"
  | "admin_ops"
  | "emergency_assistance"
  | "burial_assistance";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface CashEntry {
  id: string;
  date: string;
  direction: CashEntryDirection;
  source: CashEntrySource;
  entity: Entity;
  currency: Currency;
  amount: number;
  programId?: string;
  description: string;
  approvalStatus: ApprovalStatus;
  /** Free-text donor/payee name from the source record — not a resolved Donor.id link. */
  donorName?: string;
  /** Which raw sheet this row came from, e.g. "CASH", "Bank Statement" — provenance for real-data rows only. */
  sourceSheet?: string;
  /** True when `source`/merge status was machine-guessed with low confidence and needs a human look before this entry is treated as authoritative (e.g. for tax receipts). */
  needsReview?: boolean;
  /** Why `needsReview` is set — e.g. a keyword-classified bank row, or a same-date/same-amount collision across two donation logs with mismatched donor names. */
  reviewReason?: string;
  /** Set on both sides of a flagged possible-duplicate pair so a reviewer can find the other record. */
  duplicateOfId?: string;
}

export interface Account {
  id: string;
  name: string;
  entity: Entity;
  currency: Currency;
  balance: number;
  type: "bank" | "cash_on_hand";
}

export interface BudgetLine {
  id: string;
  programId: string;
  month: string;
  budgeted: number;
  actual: number;
}
