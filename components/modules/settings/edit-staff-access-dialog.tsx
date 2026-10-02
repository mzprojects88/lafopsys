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
import { Checkbox } from "@/components/ui/checkbox";
import { extraRoleChoices, landingChoicesFor, mainRoleChoices } from "@/lib/rbac/roles";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { ROLES, type Role } from "@/lib/types/common";
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
  extraRoles,
  clockInExempt,
  landingPath,
  isHr,
}: {
  staffId: string;
  name: string;
  role: Role;
  extraRoles: Role[];
  clockInExempt: boolean;
  landingPath: string | null;
  isHr: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [exempt, setExempt] = React.useState(clockInExempt);
  const [landing, setLanding] = React.useState(landingPath ?? ROLE_DEFAULT);
  const [hr, setHr] = React.useState(isHr);
  const [mainRole, setMainRole] = React.useState<Role>(role);
  const [extras, setExtras] = React.useState<Role[]>(extraRoles);
  const [saving, setSaving] = React.useState(false);

  const { rows: accessRows } = useModuleAccess();
  // Home-page choices follow the roles being set, not the ones saved.
  const choices = landingChoicesFor([mainRole, ...extras], accessRows);
  const sameRoles = mainRole === role && extras.length === extraRoles.length && extras.every((r) => extraRoles.includes(r));
  const changed = exempt !== clockInExempt || (landing === ROLE_DEFAULT ? null : landing) !== landingPath || hr !== isHr || !sameRoles;
  // Super Admin is only ever a main role; CEO only beside it (the server refuses otherwise).
  const extraChoices = extraRoleChoices(mainRole, extraRoles);

  function reset() {
    setExempt(clockInExempt);
    setLanding(landingPath ?? ROLE_DEFAULT);
    setHr(isHr);
    setMainRole(role);
    setExtras(extraRoles);
  }

  async function handleSave() {
    setSaving(true);
    const result = await updateStaffAccess({
      staffId,
      role: mainRole,
      extraRoles: extras,
      clockInExempt: exempt,
      landingPath: landing === ROLE_DEFAULT ? null : landing,
      isHr: hr,
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
          <Field>
            <FieldLabel htmlFor="main-role">Main role</FieldLabel>
            <Select
              value={mainRole}
              onValueChange={(v) => {
                setMainRole(v as Role);
                // CEO goes only beside Super Admin.
                setExtras((prev) => prev.filter((r) => r !== v && (r !== "ceo" || v === "admin")));
              }}
              disabled={saving}
            >
              <SelectTrigger id="main-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mainRoleChoices(role).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLES.find((x) => x.value === r)?.label ?? r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Their default first page and title come from it, unless an additional role is CEO or Office Admin.</p>
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Additional roles</legend>
            <p className="text-xs text-muted-foreground">For someone who does two jobs. They can do everything any of their roles allows.</p>
            <div className="grid grid-cols-2 gap-2">
              {extraChoices.map((r) => (
                <label key={r} htmlFor={`extra-role-${r}`} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`extra-role-${r}`}
                    checked={extras.includes(r)}
                    disabled={saving || (!extras.includes(r) && extras.length >= 3)}
                    onCheckedChange={(on) => setExtras((prev) => (on === true ? [...prev, r] : prev.filter((x) => x !== r)))}
                  />
                  {ROLES.find((x) => x.value === r)?.label ?? r}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">No clock-in needed</span>
              <span className="text-xs text-muted-foreground">
                They can use the whole app without clocking in. They can still clock in from Staff &amp; Time if they want a record.
              </span>
            </div>
            <Switch checked={exempt} onCheckedChange={setExempt} disabled={saving} />
          </div>

          {mainRole !== "admin" ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Runs HR</span>
                <span className="text-xs text-muted-foreground">
                  Employees, salaries, leave, payroll and compliance — everything under HR — without being an admin of the rest.
                </span>
              </div>
              <Switch checked={hr} onCheckedChange={setHr} disabled={saving} />
            </div>
          ) : null}

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
