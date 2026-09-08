"use server";

import { createClient } from "@/lib/supabase/server";
import { categorize, checkContinuity, naturalKey, summarizeBatch, type BankRow } from "@/lib/utils/bank-statement";

export interface ImportBankRowsInput {
  accountId: string;
  fileName: string;
  rows: BankRow[];
}

export type ImportBankRowsResult =
  | { ok: true; importId: string; inserted: number; skipped: number; warnings: number; coversFrom: string; coversTo: string }
  | { ok: false; error: string };

const CHUNK = 100;

/**
 * Commits a parsed bank statement to ops.bank_transactions.
 *
 * Runs as the caller, not the service role, so the table's RLS decides who
 * may import (admin and finance); the role check up front only makes the
 * refusal readable. Everything the preview showed is re-derived here from
 * the raw rows -- keys, categories, continuity -- because the browser is not
 * where the numbers get decided.
 *
 * Append-only by construction: rows already present are skipped by natural
 * key, nothing is updated, and the batch is recorded even when it inserts
 * nothing, so the history explains why a re-upload changed nothing.
 */
export async function importBankRows(input: ImportBankRowsInput): Promise<ImportBankRowsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: caller } = await supabase.schema("shared").from("staff").select("role").eq("id", user.id).single();
  if (caller?.role !== "admin" && caller?.role !== "finance") {
    return { ok: false, error: "Only admins and finance can import a bank statement." };
  }

  const rows = input.rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.postingDate) && Number.isFinite(r.runningBalance));
  if (rows.length === 0) return { ok: false, error: "There are no usable rows in that file." };
  const summary = summarizeBatch(rows)!;

  const { data: account } = await supabase.schema("ops").from("accounts").select("id").eq("id", input.accountId).maybeSingle();
  if (!account) return { ok: false, error: "That bank account is not on file." };

  // The last stored line before this batch, for the continuity check.
  const { data: priorRows } = await supabase
    .schema("ops")
    .from("bank_transactions")
    .select("running_balance, posting_date, row_seq")
    .eq("account_id", input.accountId)
    .lt("posting_date", summary.coversFrom)
    .order("posting_date", { ascending: false })
    .order("row_seq", { ascending: false })
    .limit(1);
  const opening = priorRows?.[0] ? Number(priorRows[0].running_balance) : null;
  const warnings = checkContinuity(rows, opening);

  const { data: existing, error: existingError } = await supabase
    .schema("ops")
    .from("bank_transactions")
    .select("posting_date, description, debit, credit, running_balance")
    .eq("account_id", input.accountId)
    .gte("posting_date", summary.coversFrom)
    .lte("posting_date", summary.coversTo);
  if (existingError) return { ok: false, error: existingError.message };
  const existingKeys = new Set(
    (existing ?? []).map((r) =>
      naturalKey(
        { postingDate: r.posting_date, description: r.description, debit: Number(r.debit), credit: Number(r.credit), runningBalance: Number(r.running_balance) },
        input.accountId
      )
    )
  );
  const fresh = rows.filter((r) => !existingKeys.has(naturalKey(r, input.accountId)));

  const { data: batch, error: batchError } = await supabase
    .schema("ops")
    .from("bank_statement_imports")
    .insert({
      account_id: input.accountId,
      file_name: input.fileName.slice(0, 200),
      source: "csv_upload",
      covers_from: summary.coversFrom,
      covers_to: summary.coversTo,
      opening_balance: opening ?? summary.impliedOpening,
      closing_balance: summary.closing,
      row_count: rows.length,
      inserted_count: fresh.length,
      skipped_count: rows.length - fresh.length,
      continuity_warnings: warnings.length,
      imported_by: user.id,
    })
    .select("id")
    .single();
  if (batchError) return { ok: false, error: batchError.message };

  const payload = fresh.map((r) => ({
    account_id: input.accountId,
    import_id: batch.id,
    row_seq: r.rowSeq,
    posting_date: r.postingDate,
    branch: r.branch,
    description: r.description,
    debit: r.debit,
    credit: r.credit,
    running_balance: r.runningBalance,
    check_number: r.checkNumber,
    memo: r.memo,
    category: categorize(r.description),
    needs_review: r.debit === 0 && r.credit === 0,
    review_reason: r.debit === 0 && r.credit === 0 ? "Amount missing in statement export" : null,
  }));

  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await supabase.schema("ops").from("bank_transactions").insert(payload.slice(i, i + CHUNK));
    if (error) {
      return { ok: false, error: `Imported ${i} of ${payload.length} new rows, then: ${error.message}` };
    }
  }

  return { ok: true, importId: batch.id, inserted: fresh.length, skipped: rows.length - fresh.length, warnings: warnings.length, coversFrom: summary.coversFrom, coversTo: summary.coversTo };
}
