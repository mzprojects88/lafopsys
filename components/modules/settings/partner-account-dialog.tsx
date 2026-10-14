"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { updatePartnerAccount } from "@/app/(app)/settings/users/actions";

/**
 * An outside (partner) account, 0090: on or off, and a new temporary PIN. It has none of the
 * staff access settings (roles, HR, clock-in, home page), so it gets this instead of
 * EditStaffAccessDialog. What it may look at is set under Roles & Access.
 */
export function PartnerAccountDialog({ staffId, name, active }: { staffId: string; name: string; active: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [on, setOn] = React.useState(active);
  const [pin, setPin] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const pinOk = pin === "" || /^\d{6}$/.test(pin);
  const changed = on !== active || pin !== "";

  async function handleSave() {
    setSaving(true);
    const result = await updatePartnerAccount({ staffId, active: on, temporaryPin: pin || null });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't save.");
      return;
    }
    toast.success(on ? `${name}: access is on.` : `${name}: access is off.`);
    setOpen(false);
    setPin("");
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setOn(active);
          setPin("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" aria-label={`Outside account settings for ${name}`}>
          <KeyRound className="size-3.5" />
          Access
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            An outside account. It opens the Inventory app to look only; the areas it sees are set under Roles &amp; Access. Turning access off
            closes it at once.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <FieldLabel htmlFor="partner-on">Access is on</FieldLabel>
            <Switch id="partner-on" checked={on} onCheckedChange={setOn} />
          </div>
          <Field>
            <FieldLabel htmlFor="partner-pin">New temporary PIN (optional)</FieldLabel>
            <Input
              id="partner-pin"
              inputMode="numeric"
              maxLength={6}
              placeholder="6 digits"
              value={pin}
              aria-invalid={!pinOk}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
            <p className="text-theme-xs text-muted-foreground">Leave empty to keep the PIN. With a new one, they choose their own at the next sign-in.</p>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !changed || !pinOk}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
