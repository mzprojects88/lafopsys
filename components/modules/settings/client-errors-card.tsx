"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils/date";

interface ClientError {
  id: number;
  at: string;
  app: "lafopsys" | "inventory";
  role: string | null;
  page: string | null;
  message: string;
  detail: Record<string, unknown>;
}

const APP_LABEL = { lafopsys: "Operating System", inventory: "LAF Inventory" } as const;

/** What the apps failed at in the browser these last seven days (shared.client_errors, 0129): the
 * Super Admin's view of errors that used to stay in the staff's console. */
export function ClientErrorsCard() {
  const [rows, setRows] = React.useState<ClientError[] | null>(null);
  const [version, setVersion] = React.useState(0);
  const [open, setOpen] = React.useState<number | null>(null);

  React.useEffect(() => {
    let live = true;
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    void createClient()
      .schema("shared")
      .from("client_errors")
      .select("id, at, app, role, page, message, detail")
      .gte("at", since)
      .order("at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (live) setRows((data ?? []) as ClientError[]);
      });
    return () => {
      live = false;
    };
  }, [version]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Failed saves and page errors the staff hit in either app, last 7 days. A repeated error is listed once per page load; names are not recorded.
        </p>
        <Button variant="outline" size="sm" onClick={() => setVersion((v) => v + 1)}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No errors in the last 7 days.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 py-2">
              <button type="button" className="flex flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <Badge variant="outline">{APP_LABEL[r.app] ?? r.app}</Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDate(r.at, "MMM d, h:mm a")}
                  {r.role ? ` · ${r.role}` : ""}
                  {r.page ? ` · ${r.page}` : ""}
                </span>
                <span className="basis-full text-sm">{r.message}</span>
              </button>
              {open === r.id && Object.keys(r.detail ?? {}).length ? (
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-2 text-xs">{JSON.stringify(r.detail, null, 2)}</pre>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
