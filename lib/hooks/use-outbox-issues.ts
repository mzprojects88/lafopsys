"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { syncFailing } from "@/lib/utils/db-sync";

/** Emails waiting for the email setup or failed (0118), counted for the Super Admin's bell. Reads nothing for anyone else. */
export function useOutboxIssues(enabled: boolean): { held: number; failed: number } {
  const [counts, setCounts] = React.useState({ held: 0, failed: 0 });
  React.useEffect(() => {
    if (!enabled) return;
    const ops = createClient().schema("ops");
    void Promise.all([
      ops.from("outbox").select("id", { count: "exact", head: true }).eq("status", "held"),
      ops.from("outbox").select("id", { count: "exact", head: true }).eq("status", "failed"),
    ]).then(([h, f]) => setCounts({ held: h.count ?? 0, failed: f.count ?? 0 }));
  }, [enabled]);
  return counts;
}

/** For the Super Admin's bell. */
export function useSyncHealth(enabled: boolean): { failing: boolean; lastSuccess: string | null } {
  const [health, setHealth] = React.useState<{ failing: boolean; lastSuccess: string | null }>({ failing: false, lastSuccess: null });
  React.useEffect(() => {
    if (!enabled) return;
    const sync = createClient().schema("sync");
    void Promise.all([
      sync.from("runs").select("status").eq("mode", "sync").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      sync.from("runs").select("started_at").eq("mode", "sync").eq("status", "success").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]).then(([last, ok]) => {
      if (last.error || !last.data) return;
      const lastSuccess = (ok.data?.started_at as string | undefined) ?? null;
      setHealth({ failing: syncFailing(last.data.status as string, lastSuccess), lastSuccess });
    });
  }, [enabled]);
  return health;
}
