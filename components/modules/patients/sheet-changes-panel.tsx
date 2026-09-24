"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Link2, Sparkles, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSheetChanges, type SheetChange } from "@/lib/hooks/use-sheet-changes";
import { patientsStore, usePatientsData } from "@/lib/hooks/use-patients-collection";
import type { Patient } from "@/lib/types/patient";

const FLAG: Record<NonNullable<SheetChange["aiFlag"]>, { label: string; className: string }> = {
  typo: { label: "Spelling fix", className: "bg-slate-100 text-slate-700 hover:bg-slate-100 dark:bg-slate-500/15 dark:text-slate-300" },
  format: { label: "Same value, written differently", className: "bg-slate-100 text-slate-700 hover:bg-slate-100 dark:bg-slate-500/15 dark:text-slate-300" },
  real: { label: "New information", className: "bg-blue-50 text-blue-700 hover:bg-blue-50 dark:bg-blue-500/15 dark:text-blue-400" },
  serious: { label: "Confirm before applying", className: "bg-rose-50 text-rose-700 hover:bg-rose-50 dark:bg-rose-500/15 dark:text-rose-400" },
  duplicate: { label: "May already be on file", className: "bg-amber-50 text-amber-700 hover:bg-amber-50 dark:bg-amber-500/15 dark:text-amber-400" },
  new: { label: "Not on file", className: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-400" },
};

/**
 * What someone changed on the original Patients Database sheet (0064): the
 * app is the record, so each edit waits here for a person to apply or
 * dismiss it, with OpenAI's reading of it. Grouped by child, oldest first.
 * Everyone who can see Patients sees it; those who can edit decide.
 */
export function SheetChangesPanel({ canDecide }: { canDecide: boolean }) {
  const { pending, changes } = useSheetChanges();
  const { patients } = usePatientsData();
  const byId = React.useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const groups = React.useMemo(() => {
    const m = new Map<string, SheetChange[]>();
    for (const c of pending) m.set(c.sheetCn, [...(m.get(c.sheetCn) ?? []), c]);
    return [...m.entries()];
  }, [pending]);
  const recent = changes.filter((c) => c.status !== "pending").slice(0, 8);

  if (pending.length === 0 && recent.length === 0) return null;
  return (
    <Card id="sheet-changes">
      <CardHeader>
        <CardTitle className="text-base">Changes on the original sheet{pending.length ? ` (${pending.length})` : ""}</CardTitle>
        <CardDescription>
          The app is the record. What staff change on the original Patients Database appears here, read by AI; it reaches the app only when someone applies it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pending.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is waiting.</p> : null}
        {groups.map(([cn, items]) => {
          const patient = items[0].patientId ? byId.get(items[0].patientId) : undefined;
          return (
            <div key={cn} className="flex flex-col gap-2 rounded-xl border p-3">
              <div className="text-sm font-medium">
                {patient ? (
                  <Link href={`/patients/${patient.id}`} className="underline-offset-4 hover:underline">
                    {patient.lastName}, {patient.firstName}
                  </Link>
                ) : (
                  items[0].sheetAfter
                )}{" "}
                <span className="text-xs font-normal text-muted-foreground">CN {cn}</span>
              </div>
              {items.map((c) => (c.kind === "new_child" ? <NewChildRow key={c.id} change={c} canDecide={canDecide} candidate={c.aiCandidatePatientId ? byId.get(c.aiCandidatePatientId) : undefined} patients={patients} /> : <FieldRow key={c.id} change={c} canDecide={canDecide} />))}
            </div>
          );
        })}
        {recent.length > 0 ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Recently decided</summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {recent.map((c) => (
                <li key={c.id}>
                  CN {c.sheetCn} · {c.label}: {c.status === "applied" ? "applied" : "dismissed"}
                  {c.decisionNote ? ` (${c.decisionNote})` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AiLine({ change }: { change: SheetChange }) {
  if (change.aiError) return <span className="text-xs text-muted-foreground">AI could not read this one; it will try again on the next read.</span>;
  if (!change.aiSummary && !change.aiFlag) return <span className="text-xs text-muted-foreground">AI is reading this change…</span>;
  const f = change.aiFlag ? FLAG[change.aiFlag] : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <Sparkles className="size-3.5 text-violet-500" />
      {f ? <Badge className={f.className}>{f.label}</Badge> : null}
      <span className="text-muted-foreground">{change.aiSummary}</span>
    </div>
  );
}

function useDecide(change: SheetChange) {
  const { decide } = useSheetChanges();
  const [busy, setBusy] = React.useState(false);
  return {
    busy,
    run: async (action: "apply" | "dismiss" | "link", extra: { patientId?: string } = {}, done = "Saved.") => {
      setBusy(true);
      const r = await decide(change.id, action, extra);
      setBusy(false);
      if (!r.ok) return toast.error(r.error);
      toast.success(done);
      await patientsStore.refetch();
    },
  };
}

function FieldRow({ change, canDecide }: { change: SheetChange; canDecide: boolean }) {
  const { busy, run } = useDecide(change);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-2.5 text-sm">
      <span className="font-medium">{change.label}</span>
      <div className="grid gap-0.5 text-xs sm:grid-cols-[6rem_1fr]">
        <span className="text-muted-foreground">Sheet</span>
        <span>
          {change.sheetBefore ? <span className="text-muted-foreground line-through">{change.sheetBefore}</span> : null}
          {change.sheetBefore ? " → " : ""}
          <b>{change.sheetAfter}</b>
        </span>
        <span className="text-muted-foreground">App now</span>
        <span>{change.appNow ?? "—"}</span>
      </div>
      <AiLine change={change} />
      {canDecide ? (
        <div className="flex gap-2">
          <Button size="sm" className="h-7 gap-1.5" disabled={busy} onClick={() => run("apply", {}, `${change.label} updated in the app.`)}>
            <Check className="size-3.5" />
            Apply
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={busy} onClick={() => run("dismiss", {}, "Dismissed; the app keeps its value.")}>
            <X className="size-3.5" />
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function NewChildRow({ change, canDecide, candidate, patients }: { change: SheetChange; canDecide: boolean; candidate: Patient | undefined; patients: Patient[] }) {
  const { busy, run } = useDecide(change);
  const [linkTo, setLinkTo] = React.useState(candidate?.id ?? "");
  const sorted = React.useMemo(() => [...patients].sort((a, b) => a.lastName.localeCompare(b.lastName)), [patients]);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-2.5 text-sm">
      <span className="font-medium">New child on the sheet</span>
      <AiLine change={change} />
      {candidate ? (
        <span className="text-xs">
          AI&apos;s closest match: <b>{candidate.lastName}, {candidate.firstName}</b> ({candidate.patientNumber}
          {change.aiConfidence != null ? `, ${Math.round(change.aiConfidence * 100)}% sure` : ""})
        </span>
      ) : null}
      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-7 gap-1.5" disabled={busy} onClick={() => run("apply", {}, "Child added to the app.")}>
            <UserPlus className="size-3.5" />
            Add as new
          </Button>
          <Select value={linkTo} onValueChange={setLinkTo}>
            <SelectTrigger className="h-7 w-52 text-xs" aria-label="Child on file to link">
              <SelectValue placeholder="Or link to a child on file" />
            </SelectTrigger>
            <SelectContent>
              {sorted.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.lastName}, {p.firstName} · {p.patientNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={busy || !linkTo} onClick={() => run("link", { patientId: linkTo }, "Linked. Its differences appear here after the next read.")}>
            <Link2 className="size-3.5" />
            Link
          </Button>
          <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => run("dismiss", {}, "Dismissed.")}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
