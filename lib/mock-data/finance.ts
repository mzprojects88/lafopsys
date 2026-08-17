import type { Account, BudgetLine, CashEntry, CashEntrySource } from "@/lib/types/finance";
import { makeRng } from "@/lib/utils/seeded-random";
import { programs } from "@/lib/mock-data/reference-data";
import realCashEntries from "@/lib/mock-data/real/cash-entries.json";

const rng = makeRng(606);

const inflowSources: CashEntrySource[] = ["cash_donation", "in_kind_donation", "capital_infusion", "grant", "fundraising_event", "interest", "inter_entity_transfer"];
const outflowSources: CashEntrySource[] = ["program_expense", "payroll", "rent_utilities", "vehicle_fuel", "admin_ops", "emergency_assistance", "burial_assistance"];

function labelFor(source: CashEntrySource) {
  return source
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const mockCashEntries: CashEntry[] = Array.from({ length: 40 }).map((_, i) => {
  const direction = rng.bool(0.55) ? "inflow" : "outflow";
  const source = direction === "inflow" ? rng.pick(inflowSources) : rng.pick(outflowSources);
  const entity = rng.bool(0.7) ? "PH_SEC" : "US_501C3";
  return {
    id: `cash-${i + 1}`,
    date: rng.daysFromNow(-rng.int(0, 210)),
    direction,
    source,
    entity,
    currency: entity === "US_501C3" ? "USD" : "PHP",
    amount: direction === "inflow" ? rng.int(2000, 80000) : rng.int(800, 40000),
    programId: direction === "outflow" ? rng.pick(programs).id : undefined,
    description: `${labelFor(source)} — ${rng.pick(["LAF House", "NCH Center", "Admin"])}`,
    approvalStatus: rng.pick(["pending", "approved", "approved", "approved", "rejected"] as const),
  };
});

// Real cash ledger (donations + bank feed + reimbursements), synced from
// DATA/clean/cash-entries.json (see scripts/sync-real-data.mjs and
// scripts/clean-finance-data.py). Falls back to seeded mock data if that
// sync hasn't run (a different machine, CI). Entries with `needsReview: true`
// were machine-classified with low confidence (unresolved CASH/BDO_CASH
// DONATIONS duplicate, or an unclassified Bank Statement/reimbursement row)
// and should not be treated as authoritative for tax receipts or board
// reporting until a human clears them -- see finance-import-report.md.
export const cashEntries: CashEntry[] =
  realCashEntries.length > 0 ? (realCashEntries as CashEntry[]) : mockCashEntries;

export const accounts: Account[] = [
  { id: "acct-ph-bdo", name: "BDO Current (PH)", entity: "PH_SEC", currency: "PHP", balance: 1284300, type: "bank" },
  { id: "acct-ph-cash", name: "Cash on Hand (PH)", entity: "PH_SEC", currency: "PHP", balance: 42500, type: "cash_on_hand" },
  { id: "acct-us-chase", name: "Chase Checking (US)", entity: "US_501C3", currency: "USD", balance: 58900, type: "bank" },
];

export const budgetLines: BudgetLine[] = programs.flatMap((p) =>
  Array.from({ length: 6 }).map((_, m) => {
    const budgeted = rng.int(30000, 180000);
    return {
      id: `budget-${p.id}-${m}`,
      programId: p.id,
      month: `2026-${String(m + 1).padStart(2, "0")}`,
      budgeted,
      actual: Math.round(budgeted * rng.random() * 0.4 + budgeted * 0.7),
    };
  })
);
