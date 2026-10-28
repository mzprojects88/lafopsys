"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Salad } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDietInstructions, type DietInstruction, type DietInstructionDraft } from "@/lib/hooks/use-diet-instructions";
import { mondayOf } from "@/lib/ai/menu-week";
import { formatDate, todayIso } from "@/lib/utils/date";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

/** After an instruction changes, this week's (and next week's, if planned) meals are checked again. */
async function recheckMenus() {
  const monday = mondayOf(todayIso());
  const nextMonday = new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const results = await Promise.all(
    [monday, nextMonday].map(async (weekStart) => {
      const res = await fetch("/api/menu/check-week", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ weekStart }) }).catch(() => null);
      const j = res ? ((await res.json().catch(() => ({}))) as { ok?: boolean; alternatives?: number; error?: string }) : null;
      return { weekStart, ok: !!j?.ok, alternatives: j?.alternatives ?? 0, error: j?.error };
    })
  );
  const checked = results.filter((r) => r.ok);
  if (!checked.length) return;
  const alts = checked.reduce((s, r) => s + r.alternatives, 0);
  toast[alts ? "warning" : "success"](alts ? `Checked the planned meals: ${alts} need an alternative plate. See House Operations › Weekly Menu.` : "Checked the planned meals: they suit everyone.");
}

const BLANK = (patientId: string): DietInstructionDraft => ({ patientId, appliesTo: "patient", carerName: null, instruction: "", givenBy: null, givenOn: todayIso(), until: null });

/**
 * A doctor's food instructions on the child's record (0120): for the child or their carer, who
 * gave it and until when. The Social Worker keeps them; everyone who sees clinical detail reads
 * them; the weekly menu's AI follows them without seeing a name.
 */
export function DietInstructionsCard({ patientId, canEdit, carers }: { patientId: string; canEdit: boolean; carers: string[] }) {
  const { forPatient, add, update, end } = useDietInstructions();
  const active = forPatient(patientId);
  const [editing, setEditing] = React.useState<{ id: string | null; draft: DietInstructionDraft } | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!editing) return;
    const d = editing.draft;
    if (d.instruction.trim().length < 3) return void toast.error("Write the instruction.");
    if (d.appliesTo === "carer" && !d.carerName?.trim()) return void toast.error("Name the carer.");
    setBusy(true);
    const r = editing.id ? await update(editing.id, d) : await add(d);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Food instruction saved");
    setEditing(null);
    void recheckMenus();
  }

  async function endOne(i: DietInstruction) {
    const r = await end(i.id);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Instruction ended");
    void recheckMenus();
  }

  const set = <K extends keyof DietInstructionDraft>(k: K, v: DietInstructionDraft[K]) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e));

  return (
    <SectionCard
      className="mb-6"
      title="Food instructions from the doctor"
      description="What the child or their carer may or may not eat. The weekly menu is planned and checked against these."
      actions={canEdit ? <Button size="sm" variant="outline" onClick={() => setEditing({ id: null, draft: BLANK(patientId) })}><Plus /> Add</Button> : null}
    >
      {active.length === 0 ? (
        <p className="text-theme-sm text-muted-foreground">None on record.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border px-3 py-2 text-theme-sm">
              <div className="min-w-0">
                <p>
                  <Badge className={STATUS_TONE_CLASSES.info}>{i.appliesTo === "carer" ? `Carer${i.carerName ? `: ${i.carerName}` : ""}` : "Child"}</Badge> <span className="font-medium">{i.instruction}</span>
                </p>
                <p className="text-theme-xs text-muted-foreground">
                  {i.givenBy ? `By ${i.givenBy}` : "Doctor not named"}
                  {i.givenOn ? ` · ${formatDate(i.givenOn)}` : ""}
                  {i.until ? ` · until ${formatDate(i.until)}` : " · until further notice"}
                </p>
              </div>
              {canEdit ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ id: i.id, draft: { patientId, appliesTo: i.appliesTo, carerName: i.carerName, instruction: i.instruction, givenBy: i.givenBy, givenOn: i.givenOn, until: i.until } })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void endOne(i)}>
                    End
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit food instruction" : "Add food instruction"}</DialogTitle>
            <DialogDescription>In the doctor&apos;s words, as given. The kitchen and the menu follow it.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="diet-who">For</FieldLabel>
                  <Select value={editing.draft.appliesTo} onValueChange={(v) => set("appliesTo", v as "patient" | "carer")}>
                    <SelectTrigger id="diet-who" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patient">The child</SelectItem>
                      <SelectItem value="carer">The carer</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {editing.draft.appliesTo === "carer" ? (
                  <Field>
                    <FieldLabel htmlFor="diet-carer">Carer</FieldLabel>
                    {carers.length ? (
                      <Select value={editing.draft.carerName ?? ""} onValueChange={(v) => set("carerName", v)}>
                        <SelectTrigger id="diet-carer" className="w-full"><SelectValue placeholder="Who" /></SelectTrigger>
                        <SelectContent>
                          {carers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input id="diet-carer" value={editing.draft.carerName ?? ""} maxLength={120} onChange={(e) => set("carerName", e.target.value)} />
                    )}
                  </Field>
                ) : null}
              </div>
              <Field>
                <FieldLabel htmlFor="diet-text">Instruction</FieldLabel>
                <Textarea id="diet-text" rows={3} maxLength={500} value={editing.draft.instruction} placeholder="e.g. Soft diet, no dairy, low salt. Boiled or steamed food only." onChange={(e) => set("instruction", e.target.value)} />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field>
                  <FieldLabel htmlFor="diet-by">Doctor</FieldLabel>
                  <Input id="diet-by" value={editing.draft.givenBy ?? ""} maxLength={120} onChange={(e) => set("givenBy", e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="diet-on">Given on</FieldLabel>
                  <Input id="diet-on" type="date" max={todayIso()} value={editing.draft.givenOn ?? ""} onChange={(e) => set("givenOn", e.target.value || null)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="diet-until">Until</FieldLabel>
                  <Input id="diet-until" type="date" value={editing.draft.until ?? ""} onChange={(e) => set("until", e.target.value || null)} />
                </Field>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

/** On the admission board: how many food instructions a family has, linking to the child's record. Empty for those without clinical detail. */
export function DietChip({ patientId }: { patientId: string }) {
  const { forPatient } = useDietInstructions();
  const active = forPatient(patientId);
  if (!active.length) return null;
  return (
    <Link href={`/patients/${patientId}`} className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2.5 py-1 text-theme-xs font-medium text-warning-foreground dark:bg-warning/15 dark:text-warning" title={active.map((i) => `${i.appliesTo === "carer" ? "Carer" : "Child"}: ${i.instruction}`).join("\n")}>
      <Salad className="size-3.5" />
      {active.length === 1 ? "Food instruction" : `${active.length} food instructions`}
    </Link>
  );
}
