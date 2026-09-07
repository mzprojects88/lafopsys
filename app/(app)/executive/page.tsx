"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { MonthlySummary } from "@/components/modules/finance/monthly-summary";
import { CalendarSnapshot } from "@/components/modules/calendar/calendar-snapshot";

/**
 * The CEO's first screen (landing_path = /executive, migration 0031).
 *
 * Two things, in the order he asked for them: the month-by-month financial
 * summary built from the bank's own record, and today's calendar with the
 * rest of the week. Both read live collections, so a statement uploaded by
 * finance or an event booked by a social worker appears here without a
 * reload. /dashboard is untouched for everyone else.
 */
export default function ExecutivePage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Executive Overview" description="Where the money stands, and what is happening this week." />
      <MonthlySummary compact />
      <CalendarSnapshot />
    </div>
  );
}
