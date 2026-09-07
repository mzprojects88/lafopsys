"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { BankCategory } from "@/lib/utils/bank-statement";

export type MutationResult = { ok: true } | { ok: false; error: string };

export interface BankTransaction {
  id: string;
  accountId: string;
  importId: string;
  rowSeq: number;
  postingDate: string;
  branch?: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  checkNumber?: string;
  memo?: string;
  category: BankCategory | null;
  needsReview: boolean;
  reviewReason?: string;
}

export interface BankStatementImport {
  id: string;
  accountId: string;
  fileName: string;
  source: "csv_upload" | "workbook_backfill" | "quickbooks";
  coversFrom: string;
  coversTo: string;
  openingBalance?: number;
  closingBalance?: number;
  rowCount: number;
  insertedCount: number;
  skippedCount: number;
  continuityWarnings: number;
  importedBy?: string;
  createdAt: string;
}

interface BankTransactionRow {
  id: string;
  account_id: string;
  import_id: string;
  row_seq: number;
  posting_date: string;
  branch: string | null;
  description: string;
  debit: string | number;
  credit: string | number;
  running_balance: string | number;
  check_number: string | null;
  memo: string | null;
  category: BankCategory | null;
  needs_review: boolean;
  review_reason: string | null;
}

interface BankStatementImportRow {
  id: string;
  account_id: string;
  file_name: string;
  source: BankStatementImport["source"];
  covers_from: string;
  covers_to: string;
  opening_balance: string | number | null;
  closing_balance: string | number | null;
  row_count: number;
  inserted_count: number;
  skipped_count: number;
  continuity_warnings: number;
  imported_by: string | null;
  created_at: string;
}

/** numeric comes back from PostgREST as a string; every money column goes through here. */
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

function toBankTransaction(row: BankTransactionRow): BankTransaction {
  return {
    id: row.id,
    accountId: row.account_id,
    importId: row.import_id,
    rowSeq: row.row_seq,
    postingDate: row.posting_date,
    branch: row.branch ?? undefined,
    description: row.description,
    debit: num(row.debit),
    credit: num(row.credit),
    runningBalance: num(row.running_balance),
    checkNumber: row.check_number ?? undefined,
    memo: row.memo ?? undefined,
    category: row.category,
    needsReview: row.needs_review,
    reviewReason: row.review_reason ?? undefined,
  };
}

function toImport(row: BankStatementImportRow): BankStatementImport {
  return {
    id: row.id,
    accountId: row.account_id,
    fileName: row.file_name,
    source: row.source,
    coversFrom: row.covers_from,
    coversTo: row.covers_to,
    openingBalance: row.opening_balance === null ? undefined : num(row.opening_balance),
    closingBalance: row.closing_balance === null ? undefined : num(row.closing_balance),
    rowCount: row.row_count,
    insertedCount: row.inserted_count,
    skippedCount: row.skipped_count,
    continuityWarnings: row.continuity_warnings,
    importedBy: row.imported_by ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * ops.bank_transactions (0033): cleared money, as the bank recorded it. The
 * only source for the monthly summary's Expenses / Donation / Cash in Bank.
 * Whole table, ordered as the bank ordered it -- a few hundred rows a year
 * is nothing, and the summary needs every month at once.
 */
export const bankTransactionsStore = createCollection<BankTransaction[]>({
  key: "ops.bank_transactions",
  empty: [],
  tables: [{ schema: "ops", table: "bank_transactions" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("bank_transactions")
      .select("*")
      .order("posting_date", { ascending: true })
      .order("row_seq", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as BankTransactionRow[]).map(toBankTransaction);
  },
});

export const bankStatementImportsStore = createCollection<BankStatementImport[]>({
  key: "ops.bank_statement_imports",
  empty: [],
  tables: [{ schema: "ops", table: "bank_statement_imports" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("bank_statement_imports")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as BankStatementImportRow[]).map(toImport);
  },
});

export function useBankTransactionsData() {
  const { data: transactions, loading, error } = useCollection(bankTransactionsStore);

  /** Finance can re-tag a line (an interest credit the keyword missed, say).
   * The only column the app ever changes on this table. */
  async function setCategory(id: string, category: BankCategory | null): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").from("bank_transactions").update({ category }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await bankTransactionsStore.refetch();
    return { ok: true };
  }

  return { transactions, loading, error, setCategory, refetch: bankTransactionsStore.refetch };
}

export function useBankStatementImportsData() {
  const { data: imports, loading, error } = useCollection(bankStatementImportsStore);
  return { imports, loading, error, refetch: bankStatementImportsStore.refetch };
}
