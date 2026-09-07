"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useEmployees, employeesStore } from "@/lib/hooks/use-employees-collection";
import { linkStaffAccount } from "@/app/(app)/hr/actions";
import type { Employee } from "@/lib/types/hr";

const NONE = "__none__";

/**
 * Ties a 201 record to the login that belongs to it. The roster shows
 * accounts not already linked to someone else; picking "No login" unlinks.
 */
export function LinkStaffAccountDialog({ employee }: { employee: Employee }) {
  const router = useRouter();
  const { staff } = useStaffRoster();
  const { employees } = useEmployees();
  const [open, setOpen] = React.useState(false);
  const [choice, setChoice] = React.useState(employee.staffId ?? NONE);
  const [saving, setSaving] = React.useState(false);

  const taken = new Set(employees.filter((e) => e.id !== employee.id && e.staffId).map((e) => e.staffId));
  const options = staff.filter((s) => s.active && !taken.has(s.id));

  async function handleSave() {
    setSaving(true);
    const result = await linkStaffAccount(employee.id, choice === NONE ? null : choice);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await employeesStore.refetch();
    toast.success(choice === NONE ? "Login unlinked." : "Login linked.");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setChoice(employee.staffId ?? NONE);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Link2 className="size-3.5" />
          {employee.staffId ? "Change login" : "Link login"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link a login</DialogTitle>
          <DialogDescription>Which staff account is {employee.firstName}&apos;s? Accounts already linked to another employee are not offered.</DialogDescription>
        </DialogHeader>
        <Select value={choice} onValueChange={setChoice}>
          <SelectTrigger className="w-full" aria-label="Staff account">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No login</SelectItem>
            {options.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.firstName} {s.lastName} · {s.position}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || choice === (employee.staffId ?? NONE)}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
