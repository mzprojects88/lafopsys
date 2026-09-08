"use client";

import * as React from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { complianceItemsStore } from "@/lib/hooks/use-compliance-collections";
import { saveComplianceItem, type ComplianceItemInput } from "@/app/(app)/compliance/actions";
import type { DueRule } from "@/lib/utils/compliance";
import { COMPLIANCE_CATEGORIES, type ComplianceApplies, type ComplianceCategory, type ComplianceFrequency, type ComplianceItem } from "@/lib/types/hr";

const RULE_KINDS: { value: DueRule["kind"]; label: string; hint: string }[] = [
  { value: "fixed", label: "Fixed date each year", hint: "A month and day; tick 'following year' for returns filed after the year closes." },
  { value: "day_of_month", label: "Day of the following month", hint: "Monthly returns: the 10th, the 15th…" },
  { value: "last_day_next_month", label: "Last day of the following month", hint: "SSS contributions." },
  { value: "quarterly", label: "Quarterly", hint: "N days after the quarter, a day of the next month, or its last day." },
  { value: "pen_digit", label: "PhilHealth schedule (PEN digit)", hint: "15th or 20th of the following month by the PEN's last digit." },
  { value: "employer_initial", label: "Pag-IBIG schedule (employer initial)", hint: "By the employer name's first letter." },
  { value: "as_needed", label: "As needed", hint: "No calendar date." },
];

/** Adds or edits an obligation. The due rule is built from fields, not typed as JSON. */
export function ComplianceItemDialog({ item, close }: { item: ComplianceItem | null; close: () => void }) {
  const r = item?.dueRule ?? { kind: "as_needed" as const };
  const [form, setForm] = React.useState<ComplianceItemInput>({
    code: item?.code ?? "",
    agency: item?.agency ?? "",
    name: item?.name ?? "",
    form: item?.form ?? "",
    category: item?.category ?? "employment",
    frequency: item?.frequency ?? "monthly",
    dueRule: r,
    applies: item?.applies ?? "yes",
    active: item?.active ?? true,
    dueOverrides: item?.dueOverrides ?? {},
    portalUrl: item?.portalUrl ?? "",
    notes: item?.notes ?? "",
  });
  // The agency's published dates for specific periods (SEC sets the AFS calendar by circular each year).
  const [overrides, setOverrides] = React.useState<{ key: string; date: string }[]>(Object.entries(item?.dueOverrides ?? {}).map(([key, date]) => ({ key, date })));
  const [rule, setRule] = React.useState<{ kind: DueRule["kind"]; month: number; day: number; yearOffset: boolean; decemberOverride: boolean; decMonth: number; decDay: number; qMode: "offset" | "day" | "monthEnd"; offsetDays: number; qDay: number; firstThree: boolean }>({
    kind: r.kind,
    month: r.kind === "fixed" ? r.month : 1,
    day: r.kind === "fixed" ? r.day : r.kind === "day_of_month" ? r.day : 10,
    yearOffset: r.kind === "fixed" ? r.yearOffset === 1 : true,
    decemberOverride: r.kind === "day_of_month" && Boolean(r.december),
    decMonth: r.kind === "day_of_month" && r.december ? r.december.month : 1,
    decDay: r.kind === "day_of_month" && r.december ? r.december.day : 15,
    qMode: r.kind === "quarterly" ? (r.offsetDays !== undefined ? "offset" : r.monthEnd ? "monthEnd" : "day") : "day",
    offsetDays: r.kind === "quarterly" && r.offsetDays !== undefined ? r.offsetDays : 60,
    qDay: r.kind === "quarterly" && r.day !== undefined ? r.day : 25,
    firstThree: r.kind === "quarterly" && Array.isArray(r.quarters) ? r.quarters.length === 3 : false,
  });
  const [saving, setSaving] = React.useState(false);

  function builtRule(): DueRule {
    switch (rule.kind) {
      case "fixed":
        return { kind: "fixed", month: rule.month, day: rule.day, yearOffset: rule.yearOffset ? 1 : 0 };
      case "day_of_month":
        return rule.decemberOverride ? { kind: "day_of_month", day: rule.day, december: { month: rule.decMonth, day: rule.decDay } } : { kind: "day_of_month", day: rule.day };
      case "quarterly": {
        const q: DueRule = { kind: "quarterly" };
        if (rule.qMode === "offset") q.offsetDays = rule.offsetDays;
        else if (rule.qMode === "day") q.day = rule.qDay;
        else q.monthEnd = true;
        if (rule.firstThree) q.quarters = [1, 2, 3];
        return q;
      }
      default:
        return { kind: rule.kind } as DueRule;
    }
  }

  async function handleSave() {
    setSaving(true);
    const res = await saveComplianceItem(item?.id ?? null, { ...form, dueRule: builtRule(), dueOverrides: Object.fromEntries(overrides.filter((o) => o.key.trim() || o.date).map((o) => [o.key.trim(), o.date])) });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    await complianceItemsStore.refetch();
    toast.success("Obligation saved.");
    close();
  }

  const set = <K extends keyof ComplianceItemInput>(k: K, v: ComplianceItemInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => Number(v) || 0;

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit obligation" : "Add obligation"}</DialogTitle>
          <DialogDescription>What is owed, to whom, and the rule that sets its date.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="ci-agency">Agency</FieldLabel>
              <Input id="ci-agency" value={form.agency} onChange={(e) => set("agency", e.target.value)} placeholder="BIR, SSS, DOLE…" />
            </Field>
            <Field>
              <FieldLabel htmlFor="ci-code">Code</FieldLabel>
              <Input id="ci-code" value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="bir_1601c" disabled={Boolean(item)} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="ci-name">Name</FieldLabel>
            <Input id="ci-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="ci-form">Form / document</FieldLabel>
              <Input id="ci-form" value={form.form} onChange={(e) => set("form", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ci-portal">Portal link</FieldLabel>
              <Input id="ci-portal" value={form.portalUrl} onChange={(e) => set("portalUrl", e.target.value)} placeholder="https://" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field>
              <FieldLabel htmlFor="ci-cat">Category</FieldLabel>
              <Select value={form.category} onValueChange={(v) => set("category", v as ComplianceCategory)}>
                <SelectTrigger id="ci-cat" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPLIANCE_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ci-freq">Frequency</FieldLabel>
              <Select value={form.frequency} onValueChange={(v) => set("frequency", v as ComplianceFrequency)}>
                <SelectTrigger id="ci-freq" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="as_needed">As needed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ci-applies">Applies</FieldLabel>
              <Select value={form.applies} onValueChange={(v) => set("applies", v as ComplianceApplies)}>
                <SelectTrigger id="ci-applies" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="if_employees">With employees</SelectItem>
                  <SelectItem value="conditional">Conditional</SelectItem>
                  <SelectItem value="not_required">Not required</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="ci-rule">Due rule</FieldLabel>
            <Select value={rule.kind} onValueChange={(v) => setRule((s) => ({ ...s, kind: v as DueRule["kind"] }))}>
              <SelectTrigger id="ci-rule" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULE_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{RULE_KINDS.find((k) => k.value === rule.kind)?.hint}</p>
          </Field>
          {rule.kind === "fixed" ? (
            <div className="grid grid-cols-3 items-end gap-4">
              <Field>
                <FieldLabel htmlFor="ci-month">Month</FieldLabel>
                <Input id="ci-month" type="number" min={1} max={12} value={rule.month} onChange={(e) => setRule((s) => ({ ...s, month: num(e.target.value) }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="ci-day">Day</FieldLabel>
                <Input id="ci-day" type="number" min={1} max={31} value={rule.day} onChange={(e) => setRule((s) => ({ ...s, day: num(e.target.value) }))} />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Switch checked={rule.yearOffset} onCheckedChange={(v) => setRule((s) => ({ ...s, yearOffset: v }))} />
                Following year
              </label>
            </div>
          ) : null}
          {rule.kind === "day_of_month" ? (
            <div className="grid grid-cols-3 items-end gap-4">
              <Field>
                <FieldLabel htmlFor="ci-dom">Day</FieldLabel>
                <Input id="ci-dom" type="number" min={1} max={31} value={rule.day} onChange={(e) => setRule((s) => ({ ...s, day: num(e.target.value) }))} />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Switch checked={rule.decemberOverride} onCheckedChange={(v) => setRule((s) => ({ ...s, decemberOverride: v }))} />
                December differs
              </label>
              {rule.decemberOverride ? (
                <Field>
                  <FieldLabel htmlFor="ci-decday">Dec return: month / day</FieldLabel>
                  <div className="flex gap-2">
                    <Input type="number" min={1} max={12} value={rule.decMonth} onChange={(e) => setRule((s) => ({ ...s, decMonth: num(e.target.value) }))} aria-label="Month" />
                    <Input id="ci-decday" type="number" min={1} max={31} value={rule.decDay} onChange={(e) => setRule((s) => ({ ...s, decDay: num(e.target.value) }))} aria-label="Day" />
                  </div>
                </Field>
              ) : null}
            </div>
          ) : null}
          {rule.kind === "quarterly" ? (
            <div className="grid grid-cols-3 items-end gap-4">
              <Field>
                <FieldLabel htmlFor="ci-qmode">Due</FieldLabel>
                <Select value={rule.qMode} onValueChange={(v) => setRule((s) => ({ ...s, qMode: v as typeof rule.qMode }))}>
                  <SelectTrigger id="ci-qmode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="offset">Days after quarter</SelectItem>
                    <SelectItem value="day">Day of next month</SelectItem>
                    <SelectItem value="monthEnd">End of next month</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {rule.qMode === "offset" ? (
                <Field>
                  <FieldLabel htmlFor="ci-off">Days</FieldLabel>
                  <Input id="ci-off" type="number" min={1} max={120} value={rule.offsetDays} onChange={(e) => setRule((s) => ({ ...s, offsetDays: num(e.target.value) }))} />
                </Field>
              ) : rule.qMode === "day" ? (
                <Field>
                  <FieldLabel htmlFor="ci-qday">Day</FieldLabel>
                  <Input id="ci-qday" type="number" min={1} max={31} value={rule.qDay} onChange={(e) => setRule((s) => ({ ...s, qDay: num(e.target.value) }))} />
                </Field>
              ) : (
                <span />
              )}
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Switch checked={rule.firstThree} onCheckedChange={(v) => setRule((s) => ({ ...s, firstThree: v }))} />
                Q1-Q3 only
              </label>
            </div>
          ) : null}

          {rule.kind !== "as_needed" ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Published dates that differ from the rule</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOverrides((o) => [...o, { key: "", date: "" }])}>
                  Add date
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">When the agency fixes a date for one period by circular (the SEC&apos;s yearly AFS calendar, say), enter the period and the date; the rule still applies to every other period.</p>
              {overrides.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="w-32" placeholder="2025 or 2026-Q2" value={o.key} onChange={(e) => setOverrides((all) => all.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} aria-label="Override period" />
                  <Input type="date" className="w-40" value={o.date} onChange={(e) => setOverrides((all) => all.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} aria-label="Override date" />
                  <Button type="button" size="sm" variant="ghost" onClick={() => setOverrides((all) => all.filter((_, j) => j !== i))} aria-label="Remove override">
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <Field>
            <FieldLabel htmlFor="ci-notes">Notes</FieldLabel>
            <Input id="ci-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">On the calendar</span>
            <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
