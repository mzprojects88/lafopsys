"use client";

import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { donorsStore, type MutationResult } from "@/lib/hooks/use-donors-collection";
import type { DonorType } from "@/lib/types/donor";
import type { CashLine, CashSource, SheetNameDecision, SheetNameHint } from "@/lib/utils/cash-gifts";

/** When a sheet was last read, and the rows that couldn't be (0084). */
export interface CashSourceStatus {
  source: CashSource;
  receivedAt: string;
  changedAt: string;
  lines: number;
  problems: string[];
}

interface CashGiftsData {
  lines: CashLine[];
  decided: SheetNameDecision[];
  hints: SheetNameHint[];
  sources: CashSourceStatus[];
}

interface LineRow {
  source: CashSource;
  line_key: string;
  sheet_row: number;
  date: string;
  donor_name: string;
  name_key: string;
  kind: CashLine["kind"];
  payment_method: CashLine["paymentMethod"] | null;
  amount: number;
  invoice_number: string | null;
  notes: string | null;
}

export const cashGiftsStore = createCollection<CashGiftsData>({
  key: "ops.cash_gift_lines",
  empty: { lines: [], decided: [], hints: [], sources: [] },
  tables: [
    { schema: "ops", table: "cash_gift_lines" },
    { schema: "ops", table: "cash_gift_sources" },
    { schema: "ops", table: "donor_sheet_names" },
    { schema: "ops", table: "sheet_name_hints" },
  ],
  fetch: async () => {
    const ops = createClient().schema("ops");
    const [lines, decided, hints, sources] = await Promise.all([
      fetchAll<LineRow>((from, to) => ops.from("cash_gift_lines").select("*").order("source").order("line_key").range(from, to)),
      fetchAll<{ name_key: string; donor_id: string | null }>((from, to) => ops.from("donor_sheet_names").select("name_key, donor_id").order("name_key").range(from, to)),
      fetchAll<{ name_key: string; type: DonorType; incomplete: boolean }>((from, to) => ops.from("sheet_name_hints").select("name_key, type, incomplete").order("name_key").range(from, to)),
      ops.from("cash_gift_sources").select("source, received_at, changed_at, lines, problems").order("source"),
    ]);
    if (sources.error) throw new Error(sources.error.message);
    return {
      lines: lines.map((r) => ({
        source: r.source,
        lineKey: r.line_key,
        sheetRow: r.sheet_row,
        date: r.date,
        donorName: r.donor_name,
        nameKey: r.name_key,
        kind: r.kind,
        paymentMethod: r.payment_method ?? undefined,
        amount: Number(r.amount),
        invoiceNumber: r.invoice_number ?? undefined,
        notes: r.notes ?? undefined,
      })),
      decided: decided.map((r) => ({ nameKey: r.name_key, donorId: r.donor_id })),
      hints: hints.map((r) => ({ nameKey: r.name_key, type: r.type, incomplete: r.incomplete })),
      sources: (sources.data ?? []).map((r) => ({
        source: r.source as CashSource,
        receivedAt: r.received_at as string,
        changedAt: r.changed_at as string,
        lines: r.lines as number,
        problems: Array.isArray(r.problems) ? (r.problems as unknown[]).map(String) : [],
      })),
    };
  },
});

/** One name's decision, as ops.decide_sheet_names takes it. */
export type NameDecision =
  | { nameKey: string; donorId: string }
  | { nameKey: string; name: string; salutation: string | null; type: DonorType }
  | { nameKey: string; skip: true };

export function useCashGifts() {
  const { data, loading } = useCollection(cashGiftsStore);

  /** Confirms names (up to 500 at once); their gifts join the donor list in the same step. */
  async function decide(decisions: NameDecision[]): Promise<MutationResult & { posted?: number }> {
    const { data: posted, error } = await createClient()
      .schema("ops")
      .rpc("decide_sheet_names", {
        p_decisions: decisions.map((d) => ("skip" in d ? { name_key: d.nameKey, skip: true } : "donorId" in d ? { name_key: d.nameKey, donor_id: d.donorId } : { name_key: d.nameKey, name: d.name, salutation: d.salutation, type: d.type })),
      });
    if (error) return { ok: false, error: error.message };
    await Promise.all([cashGiftsStore.refetch(), donorsStore.refetch()]);
    return { ok: true, posted: typeof posted === "number" ? posted : undefined };
  }

  return { ...data, loading, decide };
}
