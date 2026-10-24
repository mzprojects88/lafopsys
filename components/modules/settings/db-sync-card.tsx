"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils/date";
import { dayKey } from "@/lib/utils/dtr";
import { formatTime12 } from "@/lib/utils/time12";

interface Run {
  id: string;
  started_at: string;
  finished_at: string | null;
  mode: string;
  status: string;
  to_dev: number;
  to_prod: number;
  deleted_on_dev: number;
  deleted_on_prod: number;
  conflicts: number;
  error: string | null;
}
interface Conflict {
  table_name: string;
  pk: string;
  what: string;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${formatDate(dayKey(d))}, ${formatTime12(d.toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" }))}`;
};

/**
 * Settings › Database sync (0104, Super Admin): the hourly two-way sync between production and the
 * backup -- the last runs, what moved each way, the clashes production settled, and "Sync now".
 */
export function DbSyncCard() {
  const [runs, setRuns] = React.useState<Run[] | null>(null);
  const [conflicts, setConflicts] = React.useState<Conflict[]>([]);
  const [version, setVersion] = React.useState(0);
  const [running, setRunning] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    const db = createClient();
    void (async () => {
      const { data: r } = await db.schema("sync").from("runs").select("*").order("started_at", { ascending: false }).limit(5);
      const last = (r ?? []).find((x) => x.status === "success" && x.conflicts > 0);
      const { data: c } = last ? await db.schema("sync").from("conflicts").select("table_name, pk, what").eq("run_id", last.id).limit(20) : { data: [] };
      if (live) {
        setRuns((r ?? []) as Run[]);
        setConflicts((c ?? []) as Conflict[]);
      }
    })();
    return () => {
      live = false;
    };
  }, [version]);

  async function syncNow() {
    setRunning(true);
    const res = await fetch("/api/db-sync", { method: "POST" });
    const r = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; toDev?: number; toProd?: number; conflicts?: number };
    setRunning(false);
    if (!res.ok || r.ok === false) toast.error(r.error ?? "The sync couldn't run.");
    else toast.success(`Synced: ${r.toDev ?? 0} to the backup, ${r.toProd ?? 0} to production${r.conflicts ? `, ${r.conflicts} clash${r.conflicts === 1 ? "" : "es"} settled` : ""}.`);
    setVersion((v) => v + 1);
  }

  const last = runs?.[0];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Every hour, production and the backup database are made the same: new and changed rows go each way, a row changed on both keeps production&apos;s version.
          {last ? ` Last run ${when(last.finished_at ?? last.started_at)}: ${last.status === "failed" ? "failed" : `${last.to_dev} to the backup, ${last.to_prod} to production, ${last.conflicts} settled`}.` : " Not run yet."}
        </span>
        <Button size="sm" variant="outline" disabled={running} onClick={() => void syncNow()}>
          <RefreshCw className={running ? "animate-spin" : undefined} /> Sync now
        </Button>
      </div>
      {last?.status === "failed" ? <p className="text-xs text-destructive">Stopped, nothing written: {last.error}</p> : null}
      {runs && runs.length > 1 ? (
        <ul className="divide-y divide-border text-xs text-muted-foreground">
          {runs.slice(1).map((r) => (
            <li key={r.id} className="py-1">
              {when(r.finished_at ?? r.started_at)} · {r.mode === "dry_run" ? "check only" : r.mode === "init" ? "first copy" : "sync"} ·{" "}
              {r.status === "failed" ? <span className="text-destructive">failed</span> : `${r.to_dev} to the backup, ${r.to_prod} to production, ${r.deleted_on_dev + r.deleted_on_prod} removed, ${r.conflicts} settled`}
            </li>
          ))}
        </ul>
      ) : null}
      {conflicts.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-foreground">Clashes settled in the last run with any</p>
          <ul className="text-xs text-muted-foreground">
            {conflicts.map((c, i) => (
              <li key={i}>
                {c.table_name} · {c.pk} · {c.what}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
