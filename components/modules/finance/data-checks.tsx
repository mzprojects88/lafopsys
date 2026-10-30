"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, CircleAlert, MessageSquareText, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/patterns/section-card";
import { useDataChecks, type DataCheck } from "@/lib/hooks/use-data-checks-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useRole } from "@/lib/rbac/use-role";
import { holdsPower } from "@/lib/rbac/roles";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { formatDate } from "@/lib/utils/date";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";
import { cn } from "@/lib/utils";

const SEVERITY: Record<DataCheck["severity"], { label: string; tone: keyof typeof STATUS_TONE_CLASSES }> = {
  error: { label: "Needs a fix", tone: "negative" },
  warning: { label: "Check", tone: "warning" },
  info: { label: "Note", tone: "neutral" },
};
const DECISION: Record<string, string> = { correct: "Correct as is", fixed: "Fixed on the sheet", explained: "Explained" };

/**
 * Finance › Approvals › Data checks (0122): what the Donation Tracker sync found inconsistent --
 * unreadable rows, paper receipt numbers missing, reused or skipped, statements behind -- each
 * with the AI's one-line suggestion. Accounting decides; nothing is changed by the app.
 */
export function DataChecks() {
  const { checks, loading, decide } = useDataChecks();
  const { staff } = useStaffRoster();
  const { roles } = useRole();
  const { canEdit } = useModuleAccess();
  const decides = canEdit("finance") || canEdit("donors") || holdsPower(roles, "finance_work");
  const [showDecided, setShowDecided] = React.useState(false);
  const [explaining, setExplaining] = React.useState<DataCheck | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const open = checks.filter((c) => c.status === "open");
  const decided = checks.filter((c) => c.status !== "open" && c.status !== "cleared");
  const nameOf = (id: string | null) => {
    const s = id ? staff.find((x) => x.id === id) : null;
    return s ? `${s.firstName} ${s.lastName}` : null;
  };

  async function act(c: DataCheck, status: "correct" | "fixed" | "explained" | "open", text?: string) {
    setBusy(c.id);
    const r = await decide(c.id, status, text);
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    toast.success(status === "open" ? "Reopened" : `${DECISION[status]}: ${c.title}`);
    setExplaining(null);
    setNote("");
  }

  return (
    <SectionCard
      flush
      title="Data checks"
      description={`What the Donation Tracker check found that does not add up. ${open.length} waiting for Accounting.`}
      actions={
        decided.length ? (
          <Button size="sm" variant="ghost" onClick={() => setShowDecided((v) => !v)}>
            {showDecided ? "Hide decided" : `Decided (${decided.length})`}
          </Button>
        ) : null
      }
    >
      {loading ? (
        <p className="px-5 py-4 text-theme-sm text-muted-foreground">Loading…</p>
      ) : open.length === 0 && !showDecided ? (
        <p className="px-5 py-4 text-theme-sm text-muted-foreground">Nothing to check: the tracker, the receipts and the statements agree.</p>
      ) : (
        <ul className="divide-y divide-border">
          {(showDecided ? [...open, ...decided] : open).map((c) => (
            <li key={c.id} className="flex flex-col gap-2 px-5 py-3 text-theme-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge className={cn("border-none", STATUS_TONE_CLASSES[SEVERITY[c.severity].tone])}>{SEVERITY[c.severity].label}</Badge>
                    <span className="font-medium">{c.title}</span>
                  </div>
                  {c.suggestion ? (
                    <p className="text-theme-xs text-muted-foreground">
                      <CircleAlert className="mr-1 inline size-3.5 align-text-bottom" />
                      {c.suggestion}
                    </p>
                  ) : null}
                  {Array.isArray(c.details.rows) ? (
                    <p className="text-theme-xs text-muted-foreground">
                      Rows {(c.details.rows as { row: number; date: string; amount: number }[]).map((r) => `${r.row} (${formatDate(r.date, "MMM d")}, ₱${Number(r.amount).toLocaleString("en-PH")})`).join(", ")}
                    </p>
                  ) : null}
                  <p className="text-theme-xs text-muted-foreground">
                    First seen {formatDate(c.firstSeen.slice(0, 10))}
                    {c.status !== "open" ? ` · ${DECISION[c.status] ?? c.status}${nameOf(c.decidedBy) ? ` by ${nameOf(c.decidedBy)}` : ""}${c.decidedAt ? ` · ${formatDate(c.decidedAt.slice(0, 10))}` : ""}${c.note ? ` — ${c.note}` : ""}` : ""}
                  </p>
                </div>
                {decides ? (
                  c.status === "open" ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => act(c, "correct")}>
                        <Check /> Correct as is
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => act(c, "fixed")}>
                        <Wrench /> Fixed on the sheet
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => { setExplaining(c); setNote(""); }}>
                        <MessageSquareText /> Explain
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => act(c, "open")}>
                      Reopen
                    </Button>
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!explaining} onOpenChange={(o) => !o && setExplaining(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Explain</DialogTitle>
            <DialogDescription>{explaining?.title}</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="What it is, in a line (kept with the check)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setExplaining(null)}>Cancel</Button>
            <Button disabled={note.trim().length < 3 || busy !== null} onClick={() => explaining && act(explaining, "explained", note.trim())}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
