"use client";

import * as React from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { periodRange, periodReportRows, type CasePeriodCounts } from "@/lib/case-files/forms";
import { todayIso } from "@/lib/utils/date";
import { downloadCasePdf } from "./case-record-dialog";

/** The social worker's month or year report (phase 4): counts only, as on the PDF. */
export function CasePeriodReport() {
  const [month, setMonth] = React.useState(() => todayIso().slice(0, 7));
  const [wholeYear, setWholeYear] = React.useState(false);
  const period = wholeYear ? month.slice(0, 4) : month;
  const range = periodRange(period);
  // Kept with the period it answers, so a change of period shows the spinner, not stale numbers.
  const [result, setResult] = React.useState<{ period: string; counts: CasePeriodCounts | null; error?: string } | null>(null);
  const counts = result?.period === period ? result.counts : null;
  const failed = result?.period === period ? result.error : undefined;
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!range) return;
    let live = true;
    void createClient()
      .schema("ops")
      .rpc("case_period_report", { p_from: range.from, p_to: range.to })
      .then(({ data, error }) => live && setResult({ period, counts: error ? null : (data as CasePeriodCounts), error: error ? "The report couldn't be read. Try again in a moment." : undefined }));
    return () => {
      live = false;
    };
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = counts ? periodReportRows(counts) : [];
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Social worker&apos;s report</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" aria-label="Month" className="h-8 rounded-md border border-input bg-background px-2 text-theme-sm" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <label className="flex items-center gap-1.5 text-theme-sm">
            <input type="checkbox" checked={wholeYear} onChange={(e) => setWholeYear(e.target.checked)} /> Whole year (DSWD annual)
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !counts}
            onClick={async () => {
              setBusy(true);
              await downloadCasePdf({ period, original: false }, `Social worker report - ${period}`);
              setBusy(false);
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : <FileDown />} PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-theme-sm">
        <p className="text-muted-foreground">{range?.title}. Counts only: children housed come from the nightly record, case work from approved records.</p>
        {failed ? <p className="text-destructive">{failed}</p> : !counts ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        {rows.map((r, i) => (
          <React.Fragment key={`${r.section}-${r.label}`}>
            {r.section !== rows[i - 1]?.section && <h3 className="mt-3 text-theme-xs font-semibold uppercase text-muted-foreground">{r.section}</h3>}
            <div className="flex justify-between border-b border-border py-1">
              <span>{r.label}</span>
              <span className="font-medium tabular-nums">{r.value}</span>
            </div>
          </React.Fragment>
        ))}
      </CardContent>
    </Card>
  );
}
