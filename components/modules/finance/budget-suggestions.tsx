"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveBudgetItem } from "@/lib/hooks/use-budgets";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import { formatCurrency } from "@/lib/utils/currency";
import { MEASURES, spreadYear, type Measure } from "@/lib/utils/budgets";

interface Suggested {
  program: string | null;
  label: string;
  unit: string | null;
  measure: string | null;
  accountCode: string | null;
  yearQuantity: number | null;
  yearAmount: number | null;
  reason: string;
}

/**
 * Budgets › "Suggest from goals" (0137): items by program from the CEO's goals and the last twelve months
 * (/api/budgets/suggest; for the CEO and the Super Admin, who read the goals). Each is added to the draft with its
 * own button, its yearly figures spread evenly over the months; nothing is added by itself.
 */
export function BudgetSuggestions({ budgetId, year, sortFrom }: { budgetId: string; year: number; sortFrom: number }) {
  const { data: codes } = useSetupRows("fin_codes");
  const { data: accounts } = useSetupRows("coa_accounts");
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ summary: string; items: Suggested[] } | null>(null);
  const [added, setAdded] = React.useState<Set<number>>(new Set());

  async function ask() {
    setOpen(true);
    setBusy(true);
    setResult(null);
    setAdded(new Set());
    const res = await fetch("/api/budgets/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ year }) });
    const body = (await res.json().catch(() => null)) as ({ ok: true; summary: string; items: Suggested[] } | { ok: false; error: string }) | null;
    setBusy(false);
    if (!body?.ok) return void toast.error(body && "error" in body ? body.error : "No suggestions this time.");
    setResult({ summary: body.summary, items: body.items });
  }

  async function add(n: number, s: Suggested) {
    const q = s.yearQuantity != null ? spreadYear(s.yearQuantity) : null;
    const a = s.yearAmount != null ? spreadYear(s.yearAmount) : null;
    const r = await saveBudgetItem(null, {
      budgetId,
      t3Id: s.program ? (codes.find((c) => c.tier === "T3" && c.code === s.program)?.id as string | undefined) ?? null : null,
      label: s.label,
      unit: s.unit,
      measure: s.measure && s.measure in MEASURES ? (s.measure as Measure) : null,
      accountId: s.accountCode ? (accounts.find((x) => x.code === s.accountCode && !x.is_header && !x.review_note)?.id as string | undefined) ?? null : null,
      sort: sortFrom + n + 1,
    }, Array.from({ length: 12 }, (_, m) => ({ quantity: q ? q[m] : null, amount: a ? a[m] : null })));
    if (!r.ok) return void toast.error(r.error);
    setAdded((x) => new Set(x).add(n));
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => void ask()}>
        <Sparkles /> Suggest from goals
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Suggested items for {year}</DialogTitle>
            <DialogDescription>From the goals and the last twelve months of spending, services counted and gifts (totals only are sent). Add the ones that fit; you can change them afterwards.</DialogDescription>
          </DialogHeader>
          {busy ? <p className="text-theme-sm text-muted-foreground">Asking…</p> : null}
          {result ? (
            <div className="flex flex-col gap-3">
              <p className="rounded-xl bg-muted/50 px-3 py-2 text-theme-sm">{result.summary}</p>
              {result.items.map((s, n) => (
                <div key={n} className="flex items-start gap-3 rounded-xl border border-border p-3">
                  <div className="min-w-0 flex-1 text-theme-sm">
                    <p className="font-medium">
                      {s.label} <span className="text-theme-xs text-muted-foreground">· {s.program ? String(codes.find((c) => c.tier === "T3" && c.code === s.program)?.name ?? s.program) : "Whole foundation"}</span>
                    </p>
                    <p className="text-theme-xs tabular-nums">
                      {[s.yearQuantity != null ? `${s.yearQuantity.toLocaleString("en-PH")} ${s.unit ?? ""}`.trim() : null, s.yearAmount != null ? formatCurrency(s.yearAmount, "PHP", true) : null, s.accountCode].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-theme-xs text-muted-foreground">{s.reason}</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={added.has(n)} onClick={() => void add(n, s)}>
                    <Plus /> {added.has(n) ? "Added" : "Add"}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
