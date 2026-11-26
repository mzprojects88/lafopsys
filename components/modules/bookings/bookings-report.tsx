"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BookingRequest } from "@/lib/types/booking";
import { bookingMonths, bookingTotals, monthName, type BookingMonth } from "@/lib/utils/booking";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { todayIso } from "@/lib/utils/date";

const COLUMNS: { key: keyof Omit<BookingMonth, "month">; label: string; note?: string }[] = [
  { key: "requests", label: "Requests" },
  { key: "visits", label: "Visits held" },
  { key: "children", label: "Children reached" },
  { key: "volunteers", label: "Volunteers" },
  { key: "hours", label: "Hours" },
  { key: "upcoming", label: "Upcoming" },
  { key: "pending", label: "Pending" },
  { key: "noShow", label: "Did not come" },
  { key: "declined", label: "Declined" },
  { key: "cancelled", label: "Cancelled" },
];
const figure = (n: number) => (n ? n.toLocaleString("en-PH", { maximumFractionDigits: 2 }) : "—");

/**
 * The bookings report: a year month by month, by the day of the visit. Requests asked for that month, the visits
 * held, and what those visits gave (children reached, volunteers who came, hours) as staff recorded them. The
 * same visits are in the Program Impact report as Activity Center sessions; this page is the bookings' own view.
 */
export function BookingsReport({ requests }: { requests: BookingRequest[] }) {
  const thisYear = Number(todayIso().slice(0, 4));
  const years = [...new Set([thisYear, thisYear + 1, ...requests.map((r) => Number(r.date.slice(0, 4)))])].sort((a, b) => b - a);
  const [year, setYear] = React.useState(thisYear);
  const months = bookingMonths(requests, year);
  const totals = bookingTotals(months);

  return (
    <div className="border-t border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="max-w-prose text-theme-sm text-muted-foreground">By the day of the visit. Children, volunteers and hours are what staff recorded for the visits held.</p>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28" aria-label="Year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              downloadCsv(
                csvLines(["Month", ...COLUMNS.map((c) => c.label)], [...months.map((m) => [monthName(m.month), ...COLUMNS.map((c) => String(m[c.key]))]), ["Total", ...COLUMNS.map((c) => String(totals[c.key]))]]),
                `LAF Activity Center bookings ${year}.csv`,
              )
            }
          >
            <Download className="size-4" /> CSV
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              {COLUMNS.map((c) => (
                <TableHead key={c.key} className="text-right">
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => (
              <TableRow key={m.month} className={m.requests ? "" : "text-muted-foreground"}>
                <TableCell className="whitespace-nowrap">{monthName(m.month)}</TableCell>
                {COLUMNS.map((c) => (
                  <TableCell key={c.key} className="text-right tabular-nums">
                    {figure(m[c.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            <TableRow className="font-medium hover:bg-transparent">
              <TableCell>Total {year}</TableCell>
              {COLUMNS.map((c) => (
                <TableCell key={c.key} className="text-right tabular-nums">
                  {figure(totals[c.key])}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
