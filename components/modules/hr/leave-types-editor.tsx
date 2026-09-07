"use client";

import * as React from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useLeaveTypes, leaveTypesStore } from "@/lib/hooks/use-hr-reference-collections";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateLeaveType } from "@/app/(app)/hr/actions";
import type { LeaveType } from "@/lib/types/hr";

/**
 * Leave types. The statutory ones are seeded with their law and cannot be
 * removed, only switched off where the law does not reach (SIL under 10
 * employees, and always when VL of 5+ days discharges it). VL and SL take
 * their yearly days from Settings.
 */
export function LeaveTypesEditor() {
  const { leaveTypes, loading } = useLeaveTypes();
  const { vlDaysPerYear, slDaysPerYear } = useAppSettings();
  const [editing, setEditing] = React.useState<LeaveType | null>(null);

  const days = (t: LeaveType) => (t.entitlementSource === "settings_vl" ? vlDaysPerYear : t.entitlementSource === "settings_sl" ? slDaysPerYear : t.daysDefault);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leave types</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">Vacation and sick leave days per year are set under Settings → Pay &amp; Leave Policy. Statutory leaves carry their legal basis; eligibility is checked when a request is made.</p>
        {loading && leaveTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          leaveTypes.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {t.name}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · {days(t) === null ? "no entitlement" : `${days(t)} days${t.eligibility.perEvent ? " per event" : " / year"}`}
                    {t.paid ? "" : " · unpaid"}
                    {t.requiresDocument ? " · document required" : ""}
                  </span>
                </span>
                {t.lawRef ? <span className="text-xs text-muted-foreground">{t.lawRef}</span> : null}
              </div>
              <div className="flex items-center gap-1.5">
                {t.statutory ? <StatusBadge domain="employee" status="regular" label="Statutory" /> : null}
                <StatusBadge domain="employee" status={t.active ? "active" : "resigned"} label={t.active ? "On" : "Off"} />
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
      {editing ? <LeaveTypeDialog key={editing.id} type={editing} close={() => setEditing(null)} /> : null}
    </Card>
  );
}

function LeaveTypeDialog({ type, close }: { type: LeaveType; close: () => void }) {
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ name: type.name, active: type.active, daysDefault: type.daysDefault, requiresDocument: type.requiresDocument });
  const fixed = type.entitlementSource === "fixed";

  async function handleSave() {
    setSaving(true);
    const result = await updateLeaveType(type.id, form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await leaveTypesStore.refetch();
    toast.success(`${form.name} saved.`);
    close();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type.name}</DialogTitle>
          <DialogDescription>{type.lawRef ?? "Company leave type."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="lt-name">Name</FieldLabel>
            <Input id="lt-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          {fixed ? (
            <Field>
              <FieldLabel htmlFor="lt-days">Days{type.eligibility.perEvent ? " per event" : " per year"}</FieldLabel>
              <Input id="lt-days" type="number" min="0" step="0.5" value={form.daysDefault ?? ""} onChange={(e) => setForm({ ...form, daysDefault: e.target.value === "" ? null : Number(e.target.value) })} />
              {type.statutory ? <p className="text-xs text-muted-foreground">The law sets a minimum; more is allowed, less is not.</p> : null}
            </Field>
          ) : (
            <p className="text-xs text-muted-foreground">Days per year come from Settings → Pay &amp; Leave Policy.</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Requires a supporting document</span>
            <Switch checked={form.requiresDocument} onCheckedChange={(v) => setForm({ ...form, requiresDocument: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Available to request</span>
              {type.id === "sil" ? <span className="text-xs text-muted-foreground">Leave off while vacation leave of 5+ days discharges it (Art. 95(b)) or headcount is below 10.</span> : null}
            </div>
            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
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
