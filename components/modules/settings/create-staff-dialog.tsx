"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dices, Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLES } from "@/lib/types/common";
import { createStaffAccount } from "@/app/(app)/settings/users/actions";

function randomSixDigitPin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function suggestStaffCode(firstName: string, lastName: string) {
  return (firstName.trim() + lastName.trim()).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function CreateStaffDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [role, setRole] = React.useState<(typeof ROLES)[number]["value"] | "">("");
  const [position, setPosition] = React.useState("");
  const [staffCodeRaw, setStaffCodeRaw] = React.useState("");
  const [staffCodeTouched, setStaffCodeTouched] = React.useState(false);
  const [pin, setPin] = React.useState(randomSixDigitPin());

  // Auto-suggested from the name until the admin edits it directly — a plain
  // derived value (not synced via an effect), so it updates in the same
  // render as the name fields rather than one tick behind.
  const staffCode = staffCodeTouched ? staffCodeRaw : suggestStaffCode(firstName, lastName);

  function reset() {
    setFirstName("");
    setLastName("");
    setRole("");
    setPosition("");
    setStaffCodeRaw("");
    setStaffCodeTouched(false);
    setPin(randomSixDigitPin());
  }

  const canSubmit = firstName && lastName && role && position && staffCode.length >= 3 && /^\d{6}$/.test(pin);

  async function handleSubmit() {
    if (!canSubmit || !role) return;
    setSubmitting(true);
    const result = await createStaffAccount({ firstName, lastName, role, position, staffCode, temporaryPin: pin });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error ?? "Couldn't create the account.");
      return;
    }

    toast.success(`Account created for ${firstName} ${lastName}. Temporary PIN: ${pin} — share this with them securely.`, {
      duration: 15000,
    });
    setOpen(false);
    reset();
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
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          Create Staff Account
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Staff Account</DialogTitle>
          <DialogDescription>
            Creates a real login. They&apos;ll be required to change this temporary PIN the first time they sign in.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="firstName">First name</FieldLabel>
            <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lastName">Last name</FieldLabel>
            <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="role">Role</FieldLabel>
          <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
            <SelectTrigger id="role" className="w-full">
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="position">Position</FieldLabel>
          <Input id="position" placeholder="e.g. House Manager" value={position} onChange={(e) => setPosition(e.target.value)} />
        </Field>

        <Field>
          <FieldLabel htmlFor="staffCode">Staff code (used for login)</FieldLabel>
          <Input
            id="staffCode"
            value={staffCode}
            onChange={(e) => {
              setStaffCodeTouched(true);
              setStaffCodeRaw(e.target.value);
            }}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pin">Temporary PIN</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="pin"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="font-mono tracking-widest"
            />
            <Button type="button" variant="outline" size="icon" onClick={() => setPin(randomSixDigitPin())} title="Generate a new PIN">
              <Dices className="size-4" />
            </Button>
          </div>
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? "Creating…" : "Create Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
