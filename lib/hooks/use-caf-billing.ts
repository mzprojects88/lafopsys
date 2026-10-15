"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

export type MutationResult = { ok: true } | { ok: false; error: string };
export type CafStatus = "draft" | "final" | "sent" | "paid";

export interface CafLine {
  patientId: string;
  nights: string[];
  pwd: boolean;
  manualReason: string | null;
}

export interface CafBill {
  id: string;
  /** First day of the billed month. */
  month: string;
  status: CafStatus;
  rate: number;
  cap: number;
  discountPct: number;
  invoiceDate: string | null;
  sentAt: string | null;
  paidOn: string | null;
  paidRef: string | null;
  reopenReason: string | null;
  lines: CafLine[];
}

interface Row {
  id: string;
  month: string;
  status: CafStatus;
  rate: number;
  cap: number;
  discount_pct: number;
  invoice_date: string | null;
  sent_at: string | null;
  paid_on: string | null;
  paid_ref: string | null;
  reopen_reason: string | null;
  caf_billing_lines: { patient_id: string; nights: string[]; pwd: boolean; manual_reason: string | null }[] | null;
}

/** Every NCH billing month with its lines (0098); only billing holders get rows. */
export const cafBillsStore = createCollection<CafBill[]>({
  key: "ops.caf_billings",
  empty: [],
  tables: [
    { schema: "ops", table: "caf_billings" },
    { schema: "ops", table: "caf_billing_lines" },
  ],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("caf_billings")
      .select("id, month, status, rate, cap, discount_pct, invoice_date, sent_at, paid_on, paid_ref, reopen_reason, caf_billing_lines(patient_id, nights, pwd, manual_reason)")
      .order("month", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      month: r.month,
      status: r.status,
      rate: Number(r.rate),
      cap: r.cap,
      discountPct: Number(r.discount_pct),
      invoiceDate: r.invoice_date,
      sentAt: r.sent_at,
      paidOn: r.paid_on,
      paidRef: r.paid_ref,
      reopenReason: r.reopen_reason,
      lines: (r.caf_billing_lines ?? []).map((l) => ({ patientId: l.patient_id, nights: l.nights ?? [], pwd: l.pwd, manualReason: l.manual_reason })),
    }));
  },
});

async function done(error: { message: string } | null): Promise<MutationResult> {
  if (error) return { ok: false, error: error.message };
  await cafBillsStore.refetch();
  return { ok: true };
}

export function useCafBills() {
  const { data: bills, loading } = useCollection(cafBillsStore);
  const ops = () => createClient().schema("ops");
  return {
    bills,
    loading,
    /** Makes the month's draft, or refreshes it from the nights at LAF (lines set by hand stay). */
    draft: async (month: string) => done((await ops().rpc("caf_draft", { p_month: month })).error),
    /** A child's nights set by hand, with the reason; none removes the child from the bill. */
    setNights: async (billingId: string, patientId: string, nights: string[], reason: string) =>
      done((await ops().rpc("caf_set_nights", { p_billing_id: billingId, p_patient_id: patientId, p_nights: nights, p_reason: reason })).error),
    setStatus: async (billingId: string, status: Exclude<CafStatus, "draft">, date?: string | null, ref?: string | null) =>
      done((await ops().rpc("caf_set_status", { p_billing_id: billingId, p_status: status, p_date: date ?? null, p_ref: ref ?? null })).error),
    reopen: async (billingId: string, reason: string) => done((await ops().rpc("caf_reopen", { p_billing_id: billingId, p_reason: reason })).error),
  };
}
