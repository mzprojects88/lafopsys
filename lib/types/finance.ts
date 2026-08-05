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
