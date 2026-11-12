"use client";

import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deleteReportProfile, saveReportProfile, type ChartStyle, type Comparison, type ProfileInput, type ReportProfile } from "@/lib/hooks/use-report-profiles";
import { move } from "@/lib/utils/dashboard-catalog";
import { GENERATOR_SECTIONS, type GeneratorSectionKey } from "@/lib/utils/operations-report";
import { PRESETS } from "@/lib/utils/period-presets";

const STYLES: { value: ChartStyle; label: string }[] = [
  { value: "chart", label: "Chart and table" },
  { value: "rank", label: "Sideways bars and table" },
  { value: "table", label: "Table only" },
  { value: "figures", label: "Figures only" },
];
const COMPARISONS: { value: Comparison; label: string; note?: string }[] = [
  { value: "previous", label: "The period before, with the variance" },
  { value: "ytd", label: "Year to date" },
  { value: "goal", label: "The year's goal", note: "Shown only to the CEO, the Trustees and the Super Admin, who may read the goals." },
];
const PERIODS = PRESETS.filter((p) => !["custom", "all"].includes(p.key));
const label = (k: string) => GENERATOR_SECTIONS.find((s) => s.key === k)?.label ?? k;

/**
 * A report profile's design (0150), for the Super Admin, the CEO and Finance: its sections in order with how each is
 * drawn, the comparison columns, totals or columns, the period it opens on, one fund for the expenses, and the AI.
 */
export function ProfileEditor({ profile, funds, onClose, onSaved }: { profile: ReportProfile | null; funds: { code: string; name: string }[]; onClose: () => void; onSaved: (id: string, saved: Pick<ProfileInput, "period" | "columnsMode">) => void }) {
  const [p, setP] = React.useState<ProfileInput>(
    profile ?? { name: "", description: "", sections: ["headline", "housing"], charts: {}, comparisons: ["previous", "ytd", "goal"], columnsMode: "total", period: "this_month", fundCode: null, includeAi: true, sort: 100 },
  );
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setP((o) => ({ ...o, [k]: v }));
  const rest = GENERATOR_SECTIONS.filter((s) => !p.sections.includes(s.key));

  async function save() {
    setBusy(true);
    const r = await saveReportProfile(profile?.id ?? null, p);
    setBusy(false);
    if ("error" in r) return void toast.error(r.error);
    toast.success("Profile saved");
    onSaved(r.id, { period: p.period, columnsMode: p.columnsMode });
  }
  async function remove() {
    if (!profile) return;
    setBusy(true);
    const error = await deleteReportProfile(profile.id);
    setBusy(false);
    if (error) return void toast.error(error);
    toast.success("Profile deleted");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{profile ? `Edit ${profile.name}` : "New report profile"}</DialogTitle>
          <DialogDescription>What the report shows, in which order and how. Everyone who may open Reports can pick it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="rp-name">Name</FieldLabel>
            <Input id="rp-name" maxLength={80} value={p.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Board meeting report" />
          </Field>
          <Field>
            <FieldLabel htmlFor="rp-desc">What it is for</FieldLabel>
            <Textarea id="rp-desc" rows={2} maxLength={300} value={p.description} onChange={(e) => set("description", e.target.value)} />
          </Field>

          <section className="flex flex-col gap-2">
            <h3 className="text-theme-sm font-semibold">Sections, in order</h3>
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {p.sections.map((k, i) => (
                <li key={k} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-theme-sm">
                  <Checkbox checked onCheckedChange={() => set("sections", p.sections.filter((x) => x !== k))} aria-label={`Leave out ${label(k)}`} />
                  <span className="min-w-0 flex-1 truncate">{label(k)}</span>
                  <Select value={p.charts[k] ?? "chart"} onValueChange={(v) => set("charts", { ...p.charts, [k]: v as ChartStyle })}>
                    <SelectTrigger size="sm" className="w-44" aria-label={`How ${label(k)} is drawn`}><SelectValue /></SelectTrigger>
                    <SelectContent>{STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon-sm" disabled={i === 0} aria-label={`Move ${label(k)} up`} onClick={() => set("sections", move(p.sections, k, -1))}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon-sm" disabled={i === p.sections.length - 1} aria-label={`Move ${label(k)} down`} onClick={() => set("sections", move(p.sections, k, 1))}><ArrowDown /></Button>
                </li>
              ))}
              {rest.map((s) => (
                <li key={s.key} className="flex items-center gap-2 px-3 py-1.5 text-theme-sm text-muted-foreground">
                  <Checkbox checked={false} onCheckedChange={() => set("sections", [...p.sections, s.key as GeneratorSectionKey])} aria-label={`Add ${s.label}`} />
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
            <p className="text-theme-xs text-muted-foreground">Money sections (Donations, Expenses) show only to those who may see them.</p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-theme-sm font-semibold">Comparisons</h3>
            {COMPARISONS.map((c) => (
              <label key={c.value} className="flex items-start gap-2 text-theme-sm">
                <Checkbox checked={p.comparisons.includes(c.value)} onCheckedChange={(v) => set("comparisons", v === true ? [...p.comparisons, c.value] : p.comparisons.filter((x) => x !== c.value))} className="mt-0.5" />
                <span>{c.label}{c.note ? <span className="block text-theme-xs text-muted-foreground">{c.note}</span> : null}</span>
              </label>
            ))}
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Opens on</FieldLabel>
              <Select value={p.period} onValueChange={(v) => set("period", v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{PERIODS.map((x) => <SelectItem key={x.key} value={x.key}>{x.key === "this_year" ? "This year (to date)" : x.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Figures</FieldLabel>
              <Select value={p.columnsMode} onValueChange={(v) => set("columnsMode", v as ProfileInput["columnsMode"])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">Totals only</SelectItem>
                  <SelectItem value="columns">By day, week or month</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel>Expenses from</FieldLabel>
              <Select value={p.fundCode ?? "all"} onValueChange={(v) => set("fundCode", v === "all" ? null : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every fund</SelectItem>
                  {funds.map((f) => <SelectItem key={f.code} value={f.code}>{f.name} ({f.code})</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldDescription>Only the Expenses section follows the fund; the other figures are the whole foundation&apos;s.</FieldDescription>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-theme-sm">
            <Switch checked={p.includeAi} onCheckedChange={(v) => set("includeAi", v)} /> Include the AI analysis
          </label>
        </div>
        <DialogFooter className="flex-row flex-wrap justify-between">
          {profile ? <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => void remove()}>Delete profile</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={busy || p.name.trim().length < 2 || p.sections.length === 0} onClick={() => void save()}>{busy ? "Saving…" : "Save profile"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
