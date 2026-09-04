"use client";

import * as React from "react";
import { useCollection } from "@/lib/data/collection-store";
import { timePunchesStore } from "@/lib/hooks/use-time-punches-collection";
import { useNow } from "@/lib/hooks/use-now";
import { pairSessions, totalsFor, type DtrSession, type DtrTotals } from "@/lib/utils/dtr";

interface Options {
  /** Limit totals to these staff. Omit for everyone the viewer can see. */
  staffIds?: readonly string[];
  /** How often open sessions re-measure themselves. */
  intervalMs?: number;
}

/**
 * Sessions and live hour totals derived from the shared punches store.
 *
 * Who is in the data is decided by RLS (own punches for most roles; everyone's
 * for admin and finance), and the realtime provider refetches the store when
 * a punch lands, so the numbers move on their own. Open sessions also tick
 * with `now`. Used by /staff/dtr and the clock widget only -- deliberately not
 * by use-clock-status.ts, which is mounted in the app shell on every page.
 */
export function useDtrSessions(opts: Options = {}) {
  const { data: punches, loading } = useCollection(timePunchesStore);
  const now = useNow(opts.intervalMs ?? 60_000);
  const staffKey = opts.staffIds ? [...opts.staffIds].sort().join(",") : null;

  const sessions: DtrSession[] = React.useMemo(() => pairSessions(punches), [punches]);
  const totals: DtrTotals = React.useMemo(
    () => totalsFor(sessions, { now, staffIds: staffKey === null ? undefined : staffKey === "" ? [] : staffKey.split(",") }),
    [sessions, now, staffKey]
  );

  return { sessions, totals, punches, loading, now };
}
