"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileUp, Upload } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BankImportHistory } from "@/components/modules/finance/bank-import-history";
import { useBankTransactionsData, bankStatementImportsStore, bankTransactionsStore } from "@/lib/hooks/use-bank-transactions-collection";
import { useRole } from "@/lib/rbac/use-role";
import { formatDate } from "@/lib/utils/date";
import { checkContinuity, naturalKey, parseBankCsv, summarizeBatch, type BankRow, type ContinuityWarning } from "@/lib/utils/bank-statement";
import { importBankRows } from "./actions";
import { uploadFileToRecord } from "@/lib/files/upload-client";

/** The one account on file today (seeded by 0033). A second account is a
 * second row in ops.accounts and a picker here; nothing else changes. */
const BDO_ACCOUNT_ID = "00000000-0000-4000-8000-00000000bd01";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

type PreviewRow = BankRow & { status: "new" | "existing" | "review" };

/**
 * Upload a month's bank statement. Nothing is written until the person has
 * seen what the file contains, what is already in, and whether the balances
 * carry on from the last import. The server action re-derives all of it.
 */
export default function BankImportPage() {
  const { role } = useRole();
  const canImport = role === "admin" || role === "finance";
  const { transactions } = useBankTransactionsData();

  const [fileName, setFileName] = React.useState("");
  const [sourceFile, setSourceFile] = React.useState<File | null>(null);
  const [rows, setRows] = React.useState<BankRow[]>([]);
  const [problems, setProblems] = React.useState<string[]>([]);
  const [importing, setImporting] = React.useState(false);

  // The last stored line, for the continuity check and the "opens at" note.
  const lastStored = React.useMemo(() => {
    let last: (typeof transactions)[number] | null = null;
    for (const t of transactions) {
      if (t.accountId !== BDO_ACCOUNT_ID) continue;
      if (!last || t.postingDate > last.postingDate || (t.postingDate === last.postingDate && t.rowSeq > last.rowSeq)) last = t;
    }
    return last;
  }, [transactions]);

  const existingKeys = React.useMemo(() => new Set(transactions.filter((t) => t.accountId === BDO_ACCOUNT_ID).map((t) => naturalKey(t, BDO_ACCOUNT_ID))), [transactions]);

  const preview: PreviewRow[] = React.useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        status: existingKeys.has(naturalKey(r, BDO_ACCOUNT_ID)) ? "existing" : r.debit === 0 && r.credit === 0 ? "review" : "new",
      })),
    [rows, existingKeys]
  );
  const summary = React.useMemo(() => summarizeBatch(rows), [rows]);
  const warnings: ContinuityWarning[] = React.useMemo(() => {
    if (rows.length === 0) return [];
    const opening = lastStored && summary && lastStored.postingDate < summary.coversFrom ? lastStored.runningBalance : null;
    return checkContinuity(rows, opening);
  }, [rows, lastStored, summary]);
  const newCount = preview.filter((p) => p.status !== "existing").length;
  const opensFromLast = summary && lastStored ? Math.abs(summary.impliedOpening - lastStored.runningBalance) <= 0.01 : null;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const result = parseBankCsv(text);
    setFileName(file.name);
    setSourceFile(file);
    setRows(result.rows);
    setProblems(result.problems.map((p) => p.message));
    if (result.rows.length === 0 && result.problems.length > 0) toast.error(result.problems[0].message);
  }

  async function handleImport() {
    if (!summary) return;
    setImporting(true);
    const result = await importBankRows({ accountId: BDO_ACCOUNT_ID, fileName, rows });
    setImporting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await Promise.all([bankTransactionsStore.refetch(), bankStatementImportsStore.refetch()]);
    toast.success(
      result.inserted === 0
        ? `Nothing new — all ${result.skipped} rows were already imported.`
        : `Imported ${result.inserted} rows for ${formatDate(result.coversFrom, "MMM d")} – ${formatDate(result.coversTo, "MMM d, yyyy")}.`
    );
    // Archive the statement itself under Financial / Bank Statements / <year> / <month>, so the source of every figure is kept.
    if (sourceFile && result.inserted > 0) {
      const archived = await uploadFileToRecord("bank_statement_import", result.importId, sourceFile);
      if (!archived.ok) toast.warning(`The rows are in, but the CSV was not archived: ${archived.error}`);
    }
    setRows([]);
    setFileName("");
    setSourceFile(null);
    setProblems([]);
  }

  const columns: ColumnDef<PreviewRow>[] = [
    {
      id: "status",
      header: "",
      accessorFn: (r) => r.status,
      cell: ({ row }) =>
        row.original.status === "existing" ? (
          <span className="text-xs text-muted-foreground">Already in</span>
        ) : row.original.status === "review" ? (
          <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            No amount
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3" />
            New
          </span>
        ),
    },
    { id: "date", header: "Date", accessorFn: (r) => r.postingDate },
    { id: "description", header: "Description", accessorFn: (r) => r.description, cell: ({ row }) => <span className="block max-w-[32ch] truncate font-mono text-xs" title={row.original.description}>{row.original.description}</span> },
    { id: "memo", header: "Memo", accessorFn: (r) => r.memo ?? "", cell: ({ row }) => row.original.memo ?? <span className="text-muted-foreground">—</span> },
    { id: "debit", header: "Debit", accessorFn: (r) => r.debit, cell: ({ row }) => <span className="tabular-nums">{row.original.debit ? peso.format(row.original.debit) : ""}</span> },
    { id: "credit", header: "Credit", accessorFn: (r) => r.credit, cell: ({ row }) => <span className="tabular-nums">{row.original.credit ? peso.format(row.original.credit) : ""}</span> },
    { id: "balance", header: "Balance", accessorFn: (r) => r.runningBalance, cell: ({ row }) => <span className="tabular-nums">{peso.format(row.original.runningBalance)}</span> },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Bank Import"
        description="Bring in a month's BDO statement. Nothing is written until you have seen what it contains."
      />

      {canImport ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileUp className="size-4 text-muted-foreground" />
              Statement file
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="statement-file">CSV export from BDO online banking</Label>
              <Input id="statement-file" type="file" accept=".csv,text/csv" onChange={(e) => handleFile(e.target.files?.[0])} className="max-w-md" />
              <p className="text-xs text-muted-foreground">
                Columns: Posting Date, Branch, Description, Debit, Credit, Running Balance, Check Number — in any order. An extra unlabelled column is read as the memo.
                {lastStored ? ` The last line on file is ${formatDate(lastStored.postingDate, "MMM d, yyyy")}, closing at ${peso.format(lastStored.runningBalance)}.` : ""}
              </p>
            </div>

            {problems.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
                <p className="font-medium">{problems.length} line{problems.length === 1 ? "" : "s"} could not be read and will be left out:</p>
                <ul className="mt-1 list-disc pl-4">
                  {problems.slice(0, 8).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                  {problems.length > 8 ? <li>…and {problems.length - 8} more</li> : null}
                </ul>
              </div>
            ) : null}

            {summary ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Covers" value={`${formatDate(summary.coversFrom, "MMM d")} – ${formatDate(summary.coversTo, "MMM d, yyyy")}`} />
                <Stat label="Rows" value={`${rows.length} in file · ${newCount} new`} />
                <Stat label="Opens at" value={peso.format(summary.impliedOpening)} tone={opensFromLast === false ? "warn" : undefined} />
                <Stat label="Closes at" value={peso.format(summary.closing)} />
              </div>
            ) : null}

            {opensFromLast === false && lastStored ? (
              <Note tone="warn">
                This statement does not continue from the last import. The last line on file (
                {formatDate(lastStored.postingDate, "MMM d")}) closed at {peso.format(lastStored.runningBalance)}; this file opens at{" "}
                {peso.format(summary!.impliedOpening)}. A month may be missing in between — you can still import it.
              </Note>
            ) : null}
            {warnings.length > 0 ? (
              <Note tone="warn">
                {warnings.length} day{warnings.length === 1 ? "" : "s"} in this file do not close where the lines say they should. Usually the bank printing lines out of order; check the statement if it is more than that.
                <ul className="mt-1 list-disc pl-4">
                  {warnings.slice(0, 5).map((w) => (
                    <li key={w.postingDate}>{w.message}</li>
                  ))}
                </ul>
              </Note>
            ) : null}
            {summary && opensFromLast && warnings.length === 0 ? <Note tone="ok">Carries on exactly from the last import, and every day closes where it should.</Note> : null}

            {rows.length > 0 ? (
              <>
                <DataTable columns={columns} data={preview} searchPlaceholder="Search this file…" pageSize={15} />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    disabled={importing}
                    onClick={() => {
                      setRows([]);
                      setFileName("");
                      setProblems([]);
                    }}
                  >
                    Discard
                  </Button>
                  <Button onClick={handleImport} disabled={importing || newCount === 0}>
                    <Upload />
                    {importing ? "Importing…" : newCount === 0 ? "Nothing new to import" : `Import ${newCount} new row${newCount === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Note tone="info">Admins and finance import statements. You can see what has been imported below.</Note>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import history</CardTitle>
        </CardHeader>
        <CardContent>
          <BankImportHistory />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone === "warn" ? "border-amber-300 dark:border-amber-900/60" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function Note({ tone, children }: { tone: "warn" | "ok" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300"
      : tone === "ok"
        ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-500/10 dark:text-emerald-300"
        : "border-border bg-muted/30 text-muted-foreground";
  return <div className={`rounded-lg border px-3 py-2 text-xs ${cls}`}>{children}</div>;
}
