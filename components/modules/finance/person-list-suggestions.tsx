"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nextSort, RECIPIENT_KIND, saveSetupRow, useSetupRows } from "@/lib/hooks/use-finance-setup";

interface Suggestion {
  categories: { name: string; kind: "patient" | "provider" | "other"; reason: string }[];
  purposes: { label: string; accountCode: string; reason: string }[];
}

/**
 * "Suggest with AI" for paying a person (0135): recipient categories and purposes from LAF's programs, chart and
 * account usage (/api/requests/suggest-lists). Each suggestion is added with its own button, or left; nothing is
 * added by itself. A purpose is filed under the program whose account group holds its account (Admin otherwise).
 */
export function PersonListSuggestions() {
  const { data: codes } = useSetupRows("fin_codes");
  const { data: accounts } = useSetupRows("coa_accounts");
  const { data: categories } = useSetupRows("recipient_categories");
  const { data: types } = useSetupRows("expense_types");
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [s, setS] = React.useState<Suggestion | null>(null);
  const [added, setAdded] = React.useState<Set<string>>(new Set());

  async function ask() {
    setOpen(true);
    setBusy(true);
    setS(null);
    const res = await fetch("/api/requests/suggest-lists", { method: "POST" });
    const body = (await res.json().catch(() => null)) as ({ ok: true } & Suggestion) | { ok: false; error: string } | null;
    setBusy(false);
    if (!body?.ok) return void toast.error(body && "error" in body ? body.error : "No suggestions this time.");
    setS({ categories: body.categories, purposes: body.purposes });
  }

  const programFor = (code: string) =>
    codes.find((c) => c.tier === "T3" && c.active && ((c.account_prefixes as string[]) ?? []).some((p) => code.startsWith(p)))?.id ??
    codes.find((c) => c.tier === "T1" && c.code === "ADM")?.id;

  async function add(key: string, run: () => ReturnType<typeof saveSetupRow>) {
    const r = await run();
    if (!r.ok) return void toast.error(r.error);
    setAdded((a) => new Set(a).add(key));
    toast.success("Added");
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => void ask()}>
        <Sparkles /> Suggest with AI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Suggestions for paying a person</DialogTitle>
            <DialogDescription>From LAF&apos;s programs, its chart of accounts and how often each account was used; no names are sent. Add the ones that fit; you can change them afterwards.</DialogDescription>
          </DialogHeader>
          {busy ? <p className="text-theme-sm text-muted-foreground">Asking…</p> : null}
          {s ? (
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-2">
                <h4 className="text-theme-sm font-medium">Recipient categories</h4>
                {s.categories.length === 0 ? <p className="text-theme-xs text-muted-foreground">Nothing to add.</p> : null}
                {s.categories.map((c) => {
                  const key = `c:${c.name}`;
                  return (
                    <div key={key} className="flex items-start gap-3 rounded-xl border border-border p-3">
                      <div className="min-w-0 flex-1 text-theme-sm">
                        <p className="font-medium">{c.name} <span className="text-theme-xs text-muted-foreground">({RECIPIENT_KIND[c.kind]})</span></p>
                        <p className="text-theme-xs text-muted-foreground">{c.reason}</p>
                      </div>
                      <Button size="sm" variant="outline" disabled={added.has(key)} onClick={() => void add(key, () => saveSetupRow("recipient_categories", null, { name: c.name, kind: c.kind, active: true, sort: nextSort(categories) }))}>
                        <Plus /> {added.has(key) ? "Added" : "Add"}
                      </Button>
                    </div>
                  );
                })}
              </section>
              <section className="flex flex-col gap-2">
                <h4 className="text-theme-sm font-medium">Purposes (expense types for paying a person)</h4>
                {s.purposes.length === 0 ? <p className="text-theme-xs text-muted-foreground">Nothing to add.</p> : null}
                {s.purposes.map((p) => {
                  const key = `p:${p.label}`;
                  const account = accounts.find((a) => a.code === p.accountCode && !a.review_note);
                  const use = programFor(p.accountCode);
                  return (
                    <div key={key} className="flex items-start gap-3 rounded-xl border border-border p-3">
                      <div className="min-w-0 flex-1 text-theme-sm">
                        <p className="font-medium">{p.label} <span className="text-theme-xs text-muted-foreground">· {p.accountCode} {String(account?.name ?? "")}</span></p>
                        <p className="text-theme-xs text-muted-foreground">{p.reason}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={added.has(key) || !account || !use}
                        title={!account ? "That account has a note to settle first" : undefined}
                        onClick={() => void add(key, () => saveSetupRow("expense_types", null, { label: p.label, use_id: use, account_id: account!.id, for_person: true, active: true, sort: nextSort(types) }))}
                      >
                        <Plus /> {added.has(key) ? "Added" : "Add"}
                      </Button>
                    </div>
                  );
                })}
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
