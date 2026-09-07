"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { landingChoicesFor } from "@/lib/rbac/roles";
import type { Role } from "@/lib/types/common";
import { updateStaffAccess } from "@/app/(app)/settings/users/actions";

const ROLE_DEFAULT = "__role_default__";

/**
 * The two per-person access settings from 0031, editable by an admin from
 * Settings -> Users. Plain useState dialog like CreateStaffDialog.
 *
 * The landing choices are the nav pages THIS person's role can see, so an
 * admin cannot point a driver at /settings. The server action checks the same
 * rule again; this list is a convenience, not the gate.
 */
export function EditStaffAccessDialog({
  staffId,
  name,
  role,
  clockInExempt,
  landingPath,
}: {
  staffId: string;
  name: string;
  role: Role;
  clockInExempt: boolean;
  landingPath: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [exempt, setExempt] = React.useState(clockInExempt);
  const [landing, setLanding] = React.useState(landingPath ?? ROLE_DEFAULT);
  const [saving, setSaving] = React.useState(false);

  const choices = landingChoicesFor(role);
  const changed = exempt !== clockInExempt || (landing === ROLE_DEFAULT ? null : landing) !== landingPath;

  function reset() {
    setExempt(clockInExempt);
    setLanding(landingPath ?? ROLE_DEFAULT);
  }

  async function handleSave() {
    setSaving(true);
    const result = await updateStaffAccess({
      staffId,
      clockInExempt: exempt,
      landingPath: landing === ROLE_DEFAULT ? null : landing,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't save access settings.");
      return;
    }
    toast.success(`Access settings saved for ${name}.`);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" aria-label={`Access settings for ${name}`}>
          <KeyRound className="size-3.5" />
          Access
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Access settings</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">No clock-in needed</span>
              <span className="text-xs text-muted-foreground">
                They can use the whole app without clocking in. They can still clock in from Staff &amp; Time if they want a record.
              </span>
            </div>
            <Switch checked={exempt} onCheckedChange={setExempt} disabled={saving} />
          </div>

          <Field>
            <FieldLabel htmlFor="landing-path">First page after signing in</FieldLabel>
            <Select value={landing} onValueChange={setLanding} disabled={saving}>
              <SelectTrigger id="landing-path" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROLE_DEFAULT}>Default for their role</SelectItem>
                {choices.map((c) => (
                  <SelectItem key={c.href} value={c.href}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A bookmarked link still opens where it points; this is only where they start.
            </p>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!changed || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
