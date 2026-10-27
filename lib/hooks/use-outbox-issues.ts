"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";

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
