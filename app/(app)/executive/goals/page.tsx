"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Target } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { removeGoal, saveGoal, useGoals, type Goal } from "@/lib/hooks/use-budgets";
import { useProgramImpact } from "@/lib/hooks/use-program-impact";
import { useProgramsData } from "@/lib/hooks/use-programs-collection";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useVouchers } from "@/lib/hooks/use-vouchers";
import { useRole } from "@/lib/rbac/use-role";
import { GOAL_MEASURES, MEASURES, measureTotal, type GoalMeasure, type Measure } from "@/lib/utils/budgets";
import { formatCurrency } from "@/lib/utils/currency";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

const NONE = "__org";
const money = (m: GoalMeasure) => m === "donations" || m === "spending";
type Draft = { id: string | null; goal: Omit<Goal, "id">; targets: Record<number, string> };

/**
 * Executive › Goals (0137): the CEO's 1-, 3- and 5-year goals with a target for each year, set against what ArkOS
 * counts (Program Impact, gifts, voucher spending). The CEO and the Super Admin edit; the Trustees read; nobody
 * else opens the page. The budget's AI suggestion starts from these.
 */
export default function GoalsPage() {
  const { roles } = useRole();
  const canEdit = roles.includes("ceo") || roles.includes("admin");
  const { goals, targets, loading } = useGoals();
  const { programs } = useProgramsData();
  const { donations } = useDonorsData();
  const { vouchers, lines } = useVouchers();
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);

  const years = goals.flatMap((g) => Array.from({ length: g.horizon }, (_, i) => g.startYear + i));
  const from = years.length ? Math.min(...years) : new Date().getFullYear();
  const to = years.length ? Math.max(...years) : from;
  const impact = useProgramImpact({ from: `${from}-01-01`, to: `${to}-12-31` }, "month");
  const counted = new Set(vouchers.filter((v) => ["prepared", "reviewed", "approved"].includes(v.status)).map((v) => v.id));
  const yearOf = new Map(vouchers.map((v) => [v.id, (v.submittedAt ?? v.createdAt).slice(0, 4)]));

  const actual = (g: Goal, year: number): number | null => {
    if (g.measure === "none") return null;
    if (g.measure === "donations") return donations.filter((d) => String(d.date ?? "").startsWith(String(year))).reduce((s, d) => s + Number(d.totalValue ?? 0), 0);
    if (g.measure === "spending") return lines.filter((l) => counted.has(l.voucherId) && yearOf.get(l.voucherId) === String(year)).reduce((s, l) => s + l.amount, 0);
    return measureTotal(impact.rows.filter((r) => r.bucket.startsWith(String(year))), g.measure as Measure);
  };
  const show = (g: Goal, v: number | null) => (v == null ? "—" : money(g.measure) ? formatCurrency(v) : v.toLocaleString("en-PH"));

  const open = (g: Goal | null) =>
    setEditing({
      id: g?.id ?? null,
      goal: g ? { ...g } : { title: "", horizon: 3, startYear: new Date().getFullYear() + 1, programId: null, measure: "housing", narrative: null, status: "active", sort: goals.length + 1 },
      targets: Object.fromEntries(targets.filter((t) => t.goalId === g?.id).map((t) => [t.year, String(t.target)])),
    });
  const set = <K extends keyof Draft["goal"]>(k: K, v: Draft["goal"][K]) => setEditing((e) => (e ? { ...e, goal: { ...e.goal, [k]: v } } : e));

  async function save() {
    if (!editing) return;
    if (!editing.goal.title.trim()) return void toast.error("Name the goal.");
    setBusy(true);
    const yearsOf = Array.from({ length: editing.goal.horizon }, (_, i) => editing.goal.startYear + i);
    const r = await saveGoal(editing.id, { ...editing.goal, title: editing.goal.title.trim() }, editing.goal.measure === "none" ? [] : yearsOf.filter((y) => editing.targets[y]).map((y) => ({ year: y, target: Number(editing.targets[y]) })));
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Goal saved");
    setEditing(null);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Goals"
        description="The foundation's 1-, 3- and 5-year goals, each with a target for every year, set against what ArkOS counts. For the CEO, the Trustees and the Super Admin only."
        action={canEdit ? <Button onClick={() => open(null)}><Plus /> Add goal</Button> : null}
      />
      {!loading && goals.length === 0 ? <EmptyState icon={Target} title="No goals yet" description={canEdit ? "Add the first goal: what, by when, and the target for each year." : "The CEO hasn't set goals yet."} /> : null}
      {goals.map((g) => {
        const gy = Array.from({ length: g.horizon }, (_, i) => g.startYear + i);
        return (
          <SectionCard
            key={g.id}
            title={<span className="flex flex-wrap items-center gap-2">{g.title}<Badge className={STATUS_TONE_CLASSES[g.status === "achieved" ? "positive" : g.status === "dropped" ? "neutral" : "info"]}>{g.status}</Badge></span>}
            description={`${g.horizon}-year goal from ${g.startYear} · ${g.programId ? String(programs.find((p) => p.id === g.programId)?.name ?? "") : "Whole foundation"} · ${GOAL_MEASURES[g.measure]}`}
            actions={canEdit ? <Button size="sm" variant="outline" onClick={() => open(g)}>Edit</Button> : null}
          >
            {g.narrative ? <p className="mb-3 text-theme-sm text-muted-foreground">{g.narrative}</p> : null}
            {g.measure !== "none" ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-theme-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                      <th className="h-9 pr-4 font-medium">Year</th>
                      <th className="h-9 pr-4 text-right font-medium">Target</th>
                      <th className="h-9 pr-4 text-right font-medium">Actual</th>
                      <th className="h-9 text-right font-medium">Of target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gy.map((y) => {
                      const t = targets.find((x) => x.goalId === g.id && x.year === y)?.target ?? null;
                      const a = y <= new Date().getFullYear() ? actual(g, y) : null;
                      return (
                        <tr key={y} className="border-b border-border last:border-0">
                          <td className="py-2 pr-4 font-medium">{y}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{show(g, t)}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{show(g, a)}</td>
                          <td className="py-2 text-right tabular-nums">{t && a != null ? `${Math.round((a / t) * 100)}%` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </SectionCard>
        );
      })}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit goal" : "Add goal"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="goal-title">Goal</FieldLabel>
                <Input id="goal-title" maxLength={160} value={editing.goal.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. House more families each year" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>Horizon</FieldLabel>
                  <Select value={String(editing.goal.horizon)} onValueChange={(v) => set("horizon", Number(v) as Goal["horizon"])}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 3, 5].map((h) => <SelectItem key={h} value={String(h)}>{h} year{h > 1 ? "s" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="goal-start">From year</FieldLabel>
                  <Input id="goal-start" type="number" min={2020} max={2100} value={editing.goal.startYear} onChange={(e) => set("startYear", Number(e.target.value))} />
                </Field>
              </div>
              <Field>
                <FieldLabel>Program</FieldLabel>
                <Select value={editing.goal.programId ?? NONE} onValueChange={(v) => set("programId", v === NONE ? null : v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Whole foundation</SelectItem>
                    {programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Measured by</FieldLabel>
                <Select value={editing.goal.measure} onValueChange={(v) => set("measure", v as GoalMeasure)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(GOAL_MEASURES) as GoalMeasure[]).map((m) => (
                      <SelectItem key={m} value={m}>{GOAL_MEASURES[m]}{m in MEASURES ? ` (${MEASURES[m as Measure].unit})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {editing.goal.measure !== "none" ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {Array.from({ length: editing.goal.horizon }, (_, i) => editing.goal.startYear + i).map((y) => (
                    <Field key={y}>
                      <FieldLabel htmlFor={`goal-t-${y}`}>Target {y}</FieldLabel>
                      <Input id={`goal-t-${y}`} type="number" inputMode="decimal" min={0} value={editing.targets[y] ?? ""} onChange={(e) => setEditing((d) => (d ? { ...d, targets: { ...d.targets, [y]: e.target.value } } : d))} />
                    </Field>
                  ))}
                </div>
              ) : null}
              <Field>
                <FieldLabel htmlFor="goal-why">What it means / how we get there</FieldLabel>
                <Textarea id="goal-why" rows={3} maxLength={2000} value={editing.goal.narrative ?? ""} onChange={(e) => set("narrative", e.target.value || null)} />
              </Field>
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select value={editing.goal.status} onValueChange={(v) => set("status", v as Goal["status"])}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="achieved">Achieved</SelectItem>
                    <SelectItem value="dropped">Dropped</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            {editing?.id ? (
              <Button variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={async () => {
                if (!editing.id || !confirm("Remove this goal and its targets?")) return;
                const r = await removeGoal(editing.id);
                if (!r.ok) return void toast.error(r.error);
                setEditing(null);
              }}>Remove</Button>
            ) : null}
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
