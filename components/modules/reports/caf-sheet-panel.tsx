"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { compareCaf, type CafCompareRow } from "@/lib/utils/caf-compare";
import { cafDay } from "@/lib/utils/caf";

/**
 * "Sheet vs bill": the CAF Record tab of the LAF Programs sheet against this month's bill, read on
 * demand (the sheet isn't fetched on every visit). Compare only: fixing a night is done on the bill.
 */
export function CafSheetPanel({ month, lines, nameOf }: { month: string; lines: { patientId: string; nights: string[] }[]; nameOf: (id: string) => string }) {
  const [state, setState] = React.useState<{ month: string; rows: CafCompareRow[]; unmatched: number; error?: string } | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/caf/sheet-record?month=${month}`);
      const r = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; lines?: { patientId: string | null; dates: string[] }[] };
      if (!res.ok || r.ok === false) setState({ month, rows: [], unmatched: 0, error: r.error ?? `The sheet couldn't be read (${res.status}).` });
      else setState({ month, ...compareCaf(r.lines ?? [], lines) });
    } finally {
      setLoading(false);
    }
  }

  const current = state?.month === month ? state : null;
  const rows = current ? [...current.rows].sort((a, b) => nameOf(a.patientId).localeCompare(nameOf(b.patientId))) : [];
  const differing = rows.filter((r) => r.sheetOnly.length || r.billOnly.length).length;

  return (
    <SectionCard
      title="Sheet vs bill"
      description="The CAF Record tab of the LAF Programs sheet against this bill's nights. The bill is the record; the sheet is what staff wrote by hand."
      actions={
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={loading ? "animate-spin" : undefined} /> {current ? "Refresh" : "Compare with the sheet"}
        </Button>
      }
    >
      {!current ? (
        <p className="text-theme-sm text-muted-foreground">Not compared yet.</p>
      ) : current.error ? (
        <p className="text-theme-sm text-destructive">{current.error}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-theme-sm">
            {differing === 0 ? <Badge variant="secondary">Matches</Badge> : <Badge variant="destructive">{differing} child{differing === 1 ? "" : "ren"} differ</Badge>}
            <span className="text-muted-foreground">
              {rows.length} child{rows.length === 1 ? "" : "ren"} compared
              {current.unmatched ? ` · ${current.unmatched} name${current.unmatched === 1 ? "" : "s"} on the sheet not matched to a child on file` : ""}
            </span>
          </div>
          {rows.length > 0 ? (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const sheet = r.both + r.sheetOnly.length;
                const bill = r.both + r.billOnly.length;
                const same = !r.sheetOnly.length && !r.billOnly.length;
                return (
                  <li key={r.patientId} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between">
                    <span className="text-theme-sm font-medium text-foreground">{nameOf(r.patientId)}</span>
                    <span className={`text-theme-xs tabular-nums ${same ? "text-muted-foreground" : "text-destructive"}`}>
                      sheet {sheet} · bill {bill}
                      {r.sheetOnly.length ? ` · only on the sheet: ${r.sheetOnly.map(cafDay).join(", ")}` : ""}
                      {r.billOnly.length ? ` · only on the bill: ${r.billOnly.map(cafDay).join(", ")}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-theme-sm text-muted-foreground">Nothing listed for this month on either side.</p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
