"use client";

import * as React from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { payPeriodKey, payPeriodLabel, periodFor, semiMonthlyPeriods } from "@/lib/utils/pay-period";
import { todayIso } from "@/lib/utils/date";

/** The current pay period and the five before it, newest first. */
function recentPeriods() {
  const current = periodFor(todayIso());
  const all = [...semiMonthlyPeriods(current.year - 1), ...semiMonthlyPeriods(current.year)];
  const i = all.findIndex((p) => p.year === current.year && p.seq === current.seq);
  return all.slice(Math.max(0, i - 5), i + 1).reverse();
}

/**
 * Opens the printable DTR (DTR plan phase 5) for a pay period. `staffId` is
 * whose: the person themselves, or -- for admins, HR and finance -- whoever
 * the page's staff filter has picked; null means pick someone first.
 */
export function PrintDtrButton({ staffId }: { staffId: string | null }) {
  const periods = React.useMemo(() => recentPeriods(), []);
  const [key, setKey] = React.useState(payPeriodKey(periods[0]));
  return (
    <div className="flex items-center gap-2">
      <Select value={key} onValueChange={setKey}>
        <SelectTrigger className="w-40" aria-label="Pay period to print">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {periods.map((p) => (
            <SelectItem key={payPeriodKey(p)} value={payPeriodKey(p)}>
              {payPeriodLabel(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        className="gap-1.5"
        disabled={!staffId}
        title={staffId ? undefined : "Pick a person in the Staff filter first."}
        onClick={() => staffId && window.open(`/staff/dtr/print/${staffId}?period=${key}`, "_blank", "noopener")}
      >
        <Printer className="size-4" />
        Print DTR
      </Button>
    </div>
  );
}
