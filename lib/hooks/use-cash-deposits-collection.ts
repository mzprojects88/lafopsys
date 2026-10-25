"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

/** A deposit as the Donation Tracker's BDO_CASH DONATIONS tab lists it (0110). */
export interface CashDeposit {
  id: string;
  year: number;
  date: string;
  amount: number;
  donorName: string | null;
  invoiceNumber: string | null;
  slipNamed: string | null;
  slipAnonymous: string | null;
  notes: string | null;
}

export const cashDepositsStore = createCollection<CashDeposit[]>({
  key: "ops.cash_deposits",
  empty: [],
  tables: [{ schema: "ops", table: "cash_deposits" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("cash_deposits").select("*").order("deposit_date", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      year: Number(r.year),
      date: String(r.deposit_date),
      amount: Number(r.amount),
      donorName: (r.donor_name as string | null) ?? null,
      invoiceNumber: (r.invoice_number as string | null) ?? null,
      slipNamed: (r.slip_named as string | null) ?? null,
      slipAnonymous: (r.slip_anonymous as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
    }));
  },
});

export function useCashDepositsData() {
  const { data: deposits, loading } = useCollection(cashDepositsStore);
  return { deposits, loading };
}
