"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useRole } from "@/lib/rbac/use-role";
import { updateDocumentSettings } from "@/app/(app)/settings/actions";

const NONE = "__none__";

/**
 * What prints on cash acknowledgment receipts and donee certificates (0085): the
 * registration line under the foundation's name, its address and TIN (BIR 2322 names the
 * donee's), and the staff member who signs certificates -- their name and position come
 * from the staff record, so a change there shows on the next download.
 */
export function DocumentSettingsField() {
  const { documents, loading, refetch } = useAppSettings();
  const { staff } = useStaffRoster();
  const { role } = useRole();
  const canEdit = role === "admin";
  const [form, setForm] = React.useState(documents);
  const [saving, setSaving] = React.useState(false);
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (loading || seeded.current) return;
    seeded.current = true;
    setForm(documents);
  }, [loading, documents]);
  const changed = JSON.stringify(form) !== JSON.stringify(documents);

  async function handleSave() {
    setSaving(true);
    const result = await updateDocumentSettings(form);
    setSaving(false);
    if (!result.ok) return void toast.error(result.error ?? "Couldn't update these settings.");
    toast.success("Receipt and certificate details saved.");
    await refetch();
  }

  const signers = staff.filter((s) => s.active);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="docHeader">Registration line</Label>
        <Input id="docHeader" value={form.header} disabled={loading || !canEdit} maxLength={300} onChange={(e) => setForm({ ...form, header: e.target.value })} />
        <span className="text-xs text-muted-foreground">Printed under the foundation&apos;s name on every receipt and certificate (SEC, BIR, DSWD numbers).</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
        <div className="flex flex-col gap-1">
          <Label htmlFor="docAddress">Foundation address</Label>
          <Input id="docAddress" value={form.orgAddress} disabled={loading || !canEdit} maxLength={300} onChange={(e) => setForm({ ...form, orgAddress: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="docTin">Foundation TIN</Label>
          <Input id="docTin" value={form.orgTin} disabled={loading || !canEdit} maxLength={20} onChange={(e) => setForm({ ...form, orgTin: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="docSignatory">Signs donee certificates</Label>
        <Select value={form.signatoryId ?? NONE} disabled={loading || !canEdit} onValueChange={(v) => setForm({ ...form, signatoryId: v === NONE ? null : v })}>
          <SelectTrigger id="docSignatory" className="w-full sm:w-80">
            <SelectValue placeholder="Choose a staff member" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not set</SelectItem>
            {signers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
                {s.position ? ` · ${s.position}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Their name and position print on the certificate as the authorised representative.</span>
      </div>
      {canEdit ? (
        <div>
          <Button size="sm" variant="outline" disabled={!changed || saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
