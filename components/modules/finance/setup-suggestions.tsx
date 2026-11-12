"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { addSetupRows, type SetupRow } from "@/lib/hooks/use-finance-setup";
import { parseCsv } from "@/lib/utils/bank-statement";

/**
 * Suppliers from the registers (polish 4): Finance picks a PV, PCV or GCash register exported as CSV; its payee
 * names (not yet payees) are listed with how often they appear, and the ticked ones are added as suppliers (TINs
 * and withholding added later, row by row). Nothing leaves the browser until Finance adds them.
 */
export function PayeeSuggestions({ payees }: { payees: SetupRow[] }) {
  const [found, setFound] = React.useState<{ name: string; times: number }[] | null>(null);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const known = new Set(payees.map((p) => norm(String(p.name ?? ""))));

  async function read(file: File) {
    const rows = parseCsv(await file.text());
    // The header row is the one with a cell that says exactly "Payee" (a title row or a "Payee TIN" column won't do).
    const isPayee = (c: string) => /^\s*payee\s*$/i.test(c);
    const head = rows.findIndex((r) => r.some(isPayee));
    if (head < 0) return void toast.error("No Payee column in that file: export the register tab as CSV.");
    const col = rows[head].findIndex(isPayee);
    const counts = new Map<string, { name: string; times: number }>();
    for (const r of rows.slice(head + 1)) {
      const name = (r[col] ?? "").trim().replace(/\s+/g, " ");
      if (!name || name.length > 160 || known.has(norm(name))) continue;
      const k = name.toLowerCase();
      counts.set(k, { name: counts.get(k)?.name ?? name, times: (counts.get(k)?.times ?? 0) + 1 });
    }
    const list = [...counts.values()].sort((a, b) => b.times - a.times || a.name.localeCompare(b.name));
    setFound(list);
    setPicked(new Set());
    if (!list.length) toast.success("Every payee in that register is already a payee.");
  }

  async function add() {
    const names = (found ?? []).filter((f) => picked.has(f.name)).map((f) => f.name);
    setBusy(true);
    const r = await addSetupRows("payees", names.map((name) => ({ name, kind: "supplier", active: true })));
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${names.length} supplier${names.length === 1 ? "" : "s"} added: add their TINs and withholding below`);
    setFound((f) => (f ?? []).filter((x) => !picked.has(x.name)));
    setPicked(new Set());
  }

  return (
    <SectionCard
      title="Suppliers from the registers"
      description="Pick a register exported as CSV (PV, PCV or GCash). Its payees that aren't listed yet appear here; tick the suppliers to add. People paid (a family's aid) are better added one by one as a Person."
      actions={
        <Button size="sm" variant="outline" asChild>
          <label className="cursor-pointer">
            <FileUp /> Choose a register (CSV)
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
          </label>
        </Button>
      }
    >
      {found?.length ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-theme-sm">
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(found.map((f) => f.name)))}>Tick all {found.length}</Button>
            <Button size="sm" disabled={busy || !picked.size} onClick={() => void add()}>{busy ? "Adding…" : `Add ${picked.size} as suppliers`}</Button>
          </div>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {found.map((f) => (
              <li key={f.name} className="flex items-center gap-3 px-3 py-2 text-theme-sm">
                <Checkbox aria-label={`Add ${f.name}`} checked={picked.has(f.name)} onCheckedChange={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(f.name); else n.delete(f.name); return n; })} />
                <span className="flex-1">{f.name}</span>
                <span className="text-theme-xs text-muted-foreground">{f.times} voucher{f.times === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-theme-sm text-muted-foreground">No register read yet.</p>
      )}
    </SectionCard>
  );
}

/** Common BIR expanded-withholding codes to start from (polish 4). Suggestions only: Finance confirms each rate
 * with the accountant before adding it, and nothing is withheld by a rate that isn't added. */
const SUGGESTED = [
  { atc: "WC158", description: "Purchase of goods from a corporation (top withholding agent)", rate: 1 },
  { atc: "WI158", description: "Purchase of goods from an individual (top withholding agent)", rate: 1 },
  { atc: "WC160", description: "Purchase of services from a corporation (top withholding agent)", rate: 2 },
  { atc: "WI160", description: "Purchase of services from an individual (top withholding agent)", rate: 2 },
  { atc: "WC100", description: "Rental of real property, corporation", rate: 5 },
  { atc: "WI100", description: "Rental of real property, individual", rate: 5 },
  { atc: "WC120", description: "Contractors, corporation", rate: 2 },
  { atc: "WI120", description: "Contractors, individual", rate: 2 },
  { atc: "WI010", description: "Professional fees, individual (gross up to ₱3M)", rate: 5 },
  { atc: "WC010", description: "Professional fees, corporation (gross up to ₱720K)", rate: 10 },
];

export function EwtSuggestions({ rates }: { rates: SetupRow[] }) {
  const have = new Set(rates.map((r) => String(r.atc)));
  const left = SUGGESTED.filter((s) => !have.has(s.atc));
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!left.length) return null;
  async function add(s: (typeof SUGGESTED)[number]) {
    if (!confirm(`Add ${s.atc} at ${s.rate}%? Confirm the rate with the accountant first.`)) return;
    setBusy(s.atc);
    const r = await addSetupRows("ewt_rates", [{ ...s, active: true }]);
    setBusy(null);
    toast[r.ok ? "success" : "error"](r.ok ? `${s.atc} added` : r.error);
  }
  return (
    <SectionCard title="Withholding rates to start from" description="Common BIR codes, as suggestions: confirm each rate with the accountant before adding it. A payee withholds only by a rate added here.">
      <ul className="divide-y divide-border rounded-xl border border-border">
        {left.map((s) => (
          <li key={s.atc} className="flex flex-wrap items-center gap-3 px-3 py-2 text-theme-sm">
            <span className="w-16 font-medium tabular-nums">{s.atc}</span>
            <span className="flex-1">{s.description}</span>
            <span className="tabular-nums">{s.rate}%</span>
            <Button size="sm" variant="outline" disabled={busy === s.atc} onClick={() => void add(s)}>Add</Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
