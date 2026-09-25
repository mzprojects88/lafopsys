"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Link2, Sparkles, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/patterns/section-card";
import { STATUS_TONE_CLASSES, type StatusTone } from "@/lib/utils/status-colors";
import { useSheetChanges, type SheetChange } from "@/lib/hooks/use-sheet-changes";
import { patientsStore, usePatientsData } from "@/lib/hooks/use-patients-collection";
import type { Patient } from "@/lib/types/patient";

const FLAG: Record<NonNullable<SheetChange["aiFlag"]>, { label: string; tone: StatusTone }> = {
  typo: { label: "Spelling fix", tone: "neutral" },
  format: { label: "Same value, written differently", tone: "neutral" },
  real: { label: "New information", tone: "info" },
  serious: { label: "Confirm before applying", tone: "negative" },
  duplicate: { label: "May already be on file", tone: "warning" },
  new: { label: "Not on file", tone: "positive" },
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
    <div id="sheet-changes">
      <SectionCard
        title={`Changes on the original sheet${pending.length ? ` (${pending.length})` : ""}`}
        description="The app is the record. What staff change on the original Patients Database appears here, read by AI; it reaches the app only when someone applies it."
        flush
        bodyClassName="flex flex-col divide-y divide-border"
      >
        {pending.length === 0 ? <p className="px-5 py-3 text-theme-sm text-muted-foreground">Nothing is waiting.</p> : null}
        {groups.map(([cn, items]) => {
          const patient = items[0].patientId ? byId.get(items[0].patientId) : undefined;
          return (
            <div key={cn} className="flex flex-col gap-2 px-5 py-4">
              <div className="text-theme-sm font-medium">
                {patient ? (
                  <Link href={`/patients/${patient.id}`} className="underline-offset-4 hover:underline">
                    {patient.lastName}, {patient.firstName}
                  </Link>
                ) : (
                  items[0].sheetAfter
                )}{" "}
                <span className="text-theme-xs font-normal text-muted-foreground">CN {cn}</span>
              </div>
              {items.map((c) => (c.kind === "new_child" ? <NewChildRow key={c.id} change={c} canDecide={canDecide} candidate={c.aiCandidatePatientId ? byId.get(c.aiCandidatePatientId) : undefined} patients={patients} /> : <FieldRow key={c.id} change={c} canDecide={canDecide} />))}
            </div>
          );
        })}
        {recent.length > 0 ? (
          <details className="px-5 py-3 text-theme-xs text-muted-foreground">
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
      </SectionCard>
    </div>
  );
}

function AiLine({ change }: { change: SheetChange }) {
  if (change.aiError) return <span className="text-theme-xs text-muted-foreground">AI could not read this one; it will try again on the next read.</span>;
  if (!change.aiSummary && !change.aiFlag) return <span className="text-theme-xs text-muted-foreground">AI is reading this change…</span>;
  const f = change.aiFlag ? FLAG[change.aiFlag] : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-theme-xs">
      <Sparkles className="size-3.5 text-primary" />
      {f ? <Badge className={STATUS_TONE_CLASSES[f.tone]}>{f.label}</Badge> : null}
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
    <div className="flex flex-col gap-1.5 rounded-xl bg-muted/60 p-3 text-theme-sm">
      <span className="font-medium">{change.label}</span>
      <div className="grid gap-0.5 text-theme-xs sm:grid-cols-[6rem_1fr]">
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
          <Button size="sm" disabled={busy} onClick={() => run("apply", {}, `${change.label} updated in the app.`)}>
            <Check />
            Apply
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run("dismiss", {}, "Dismissed; the app keeps its value.")}>
            <X />
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
    <div className="flex flex-col gap-1.5 rounded-xl bg-muted/60 p-3 text-theme-sm">
      <span className="font-medium">New child on the sheet</span>
      <AiLine change={change} />
      {candidate ? (
        <span className="text-theme-xs">
          AI&apos;s closest match: <b>{candidate.lastName}, {candidate.firstName}</b> ({candidate.patientNumber}
          {change.aiConfidence != null ? `, ${Math.round(change.aiConfidence * 100)}% sure` : ""})
        </span>
      ) : null}
      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => run("apply", {}, "Child added to the app.")}>
            <UserPlus />
            Add as new
          </Button>
          <Select value={linkTo} onValueChange={setLinkTo}>
            <SelectTrigger size="sm" className="w-52 text-theme-xs" aria-label="Child on file to link">
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
          <Button size="sm" variant="outline" disabled={busy || !linkTo} onClick={() => run("link", { patientId: linkTo }, "Linked. Its differences appear here after the next read.")}>
            <Link2 />
            Link
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("dismiss", {}, "Dismissed.")}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
