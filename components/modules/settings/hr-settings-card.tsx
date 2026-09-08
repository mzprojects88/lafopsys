"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppSettings, type HrSettings, type PayDateRule } from "@/lib/hooks/use-app-settings";
import { useRole } from "@/lib/rbac/use-role";
import { updateHrSettings } from "@/app/(app)/settings/actions";

/**
 * The foundation's pay and leave policy (0038), saved as one form. These are
 * the numbers payroll and leave balances are computed from; changing one
 * re-computes every screen that shows them, so the copy under each field
 * says what the law requires and what is the foundation's own choice.
 */
export function HrSettingsCard() {
  const settings = useAppSettings();
  const { role } = useRole();
  if (settings.loading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  // Keyed on the saved values: a successful save remounts the form on the
  // new baseline, and typing is never overwritten by a background refetch.
  const initial = pick(settings);
  return <HrSettingsForm key={JSON.stringify(initial)} initial={initial} canEdit={role === "admin"} refetch={settings.refetch} />;
}

function HrSettingsForm({ initial, canEdit, refetch }: { initial: HrSettings; canEdit: boolean; refetch: () => Promise<void> }) {
  const [form, setForm] = React.useState<HrSettings>(initial);
  const [saving, setSaving] = React.useState(false);

  const changed = JSON.stringify(form) !== JSON.stringify(initial);
  const rule = form.payDateRule;

  function setRule(next: PayDateRule) {
    setForm((f) => ({ ...f, payDateRule: next }));
  }

  async function handleSave() {
    setSaving(true);
    const result = await updateHrSettings(form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't save HR settings.");
      return;
    }
    toast.success("HR settings saved.");
    await refetch();
  }

  return (
    <div className="flex flex-col gap-5">
      <Row label="Pay date" hint="Wages must be paid at least twice a month, no more than sixteen days apart (Labor Code Art. 103).">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={rule.kind}
            disabled={!canEdit}
            onValueChange={(v) => setRule(v === "fixed" ? { kind: "fixed", first: 20, second: 5 } : { kind: "offset", days: 5 })}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="offset">Days after the cutoff</SelectItem>
              <SelectItem value="fixed">Fixed days of the month</SelectItem>
            </SelectContent>
          </Select>
          {rule.kind === "offset" ? (
            <NumberInput label="Days after cutoff" value={rule.days} min={0} max={15} disabled={!canEdit} onChange={(days) => setRule({ kind: "offset", days })} />
          ) : (
            <>
              <NumberInput label="1–15 paid on the" value={rule.first} min={1} max={31} disabled={!canEdit} onChange={(first) => setRule({ ...rule, first })} />
              <NumberInput label="16–end paid on the" value={rule.second} min={1} max={31} disabled={!canEdit} onChange={(second) => setRule({ ...rule, second })} />
            </>
          )}
        </div>
      </Row>

      <Row label="Government contributions" hint="SSS, PhilHealth and Pag-IBIG are monthly amounts. Deduct them all on the second cutoff, or half on each.">
        <Select value={form.contributionCutoff} disabled={!canEdit} onValueChange={(v) => setForm({ ...form, contributionCutoff: v as HrSettings["contributionCutoff"] })}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="second">Second cutoff only</SelectItem>
            <SelectItem value="split">Split across both</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Tardiness grace period" hint="Minutes late that are not deducted. Not required by law, and once given it cannot be taken back (Art. 100).">
        <NumberInput label="Minutes" value={form.tardinessGraceMinutes} min={0} max={60} disabled={!canEdit} onChange={(tardinessGraceMinutes) => setForm({ ...form, tardinessGraceMinutes })} />
      </Row>

      <Row label="Vacation leave per year" hint="Five or more days covers the Service Incentive Leave the Labor Code requires after a year (Art. 95). Accrues monthly.">
        <NumberInput label="Days" value={form.vlDaysPerYear} min={0} max={60} step={0.5} disabled={!canEdit} onChange={(vlDaysPerYear) => setForm({ ...form, vlDaysPerYear })} />
      </Row>

      <Row label="Sick leave per year" hint="The foundation's own benefit; the law does not require paid sick leave beyond SSS sickness benefit.">
        <NumberInput label="Days" value={form.slDaysPerYear} min={0} max={60} step={0.5} disabled={!canEdit} onChange={(slDaysPerYear) => setForm({ ...form, slDaysPerYear })} />
      </Row>

      <Row label="Unused vacation leave is paid out" hint="At year end and in final pay. The five SIL days are always commutable by law; anything above is policy.">
        <Switch checked={form.vlConvertible} disabled={!canEdit} onCheckedChange={(vlConvertible) => setForm({ ...form, vlConvertible })} />
      </Row>

      <Row label="Minimum wage region" hint="Which regional wage order applies — NCR for the foundation's houses.">
        <Input className="w-24 uppercase" value={form.minimumWageRegion} disabled={!canEdit} onChange={(e) => setForm({ ...form, minimumWageRegion: e.target.value })} aria-label="Minimum wage region" />
      </Row>

      <Row label="PhilHealth Employer Number, last digit" hint="PEN ending 0-4 remits by the 15th of the following month, 5-9 by the 20th. PhilHealth dates on the compliance calendar wait for this.">
        <Input
          className="w-20"
          inputMode="numeric"
          maxLength={1}
          value={form.compliancePenLastDigit === null ? "" : String(form.compliancePenLastDigit)}
          disabled={!canEdit}
          onChange={(e) => setForm({ ...form, compliancePenLastDigit: e.target.value === "" ? null : Number(e.target.value.slice(-1)) })}
          aria-label="PEN last digit"
        />
      </Row>

      <Row label="Employer name, first letter" hint="Pag-IBIG's remittance window runs by it: A-D by the 14th, E-L the 19th, M-Q the 24th, R-Z month-end.">
        <Input className="w-20 uppercase" maxLength={1} value={form.complianceEmployerInitial ?? ""} disabled={!canEdit} onChange={(e) => setForm({ ...form, complianceEmployerInitial: e.target.value.slice(-1) || null })} aria-label="Employer initial" />
      </Row>

      <Row label="Compliance calendar starts" hint="Obligations for months before this are not shown as overdue; the months were handled outside the system.">
        <Input type="date" className="w-40" value={form.complianceTrackingFrom} disabled={!canEdit} onChange={(e) => setForm({ ...form, complianceTrackingFrom: e.target.value })} aria-label="Compliance tracking from" />
      </Row>

      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" disabled={!changed || saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save HR settings"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function pick(s: HrSettings): HrSettings {
  return {
    payDateRule: s.payDateRule,
    contributionCutoff: s.contributionCutoff,
    tardinessGraceMinutes: s.tardinessGraceMinutes,
    vlDaysPerYear: s.vlDaysPerYear,
    slDaysPerYear: s.slDaysPerYear,
    vlConvertible: s.vlConvertible,
    minimumWageRegion: s.minimumWageRegion,
    compliancePenLastDigit: s.compliancePenLastDigit,
    complianceEmployerInitial: s.complianceEmployerInitial,
    complianceTrackingFrom: s.complianceTrackingFrom,
  };
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        className="w-20"
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        aria-label={label}
      />
    </label>
  );
}
