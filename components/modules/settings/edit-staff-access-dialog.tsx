"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ADMIN_ONLY_MODULES, NAV_ITEMS, extraRoleChoices, landingChoicesFor, levelFor, mainRoleChoices, type AccessLevel, type ModuleKey, type Overrides } from "@/lib/rbac/roles";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useRole } from "@/context/role-provider";
import { ROLES, type Role } from "@/lib/types/common";
import { deleteStaffAccount, setStaffOverride, updateStaffAccess } from "@/app/(app)/settings/users/actions";

const LEVEL_LABEL: Record<AccessLevel, string> = { none: "None", view: "View only", edit: "Edit" };
const ROLE_LEVEL = "__role__";
/** The modules an admin can set for one person: the menu, minus Settings (admins only) and minus HR and
 * Compliances, which follow the roles and the "Runs HR" switch above rather than the grid. */
const PERSON_MODULES = NAV_ITEMS.filter((n) => !ADMIN_ONLY_MODULES.includes(n.module) && n.module !== "hr" && n.module !== "compliance");

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
  active,
  overrides,
}: {
  staffId: string;
  name: string;
  role: Role;
  extraRoles: Role[];
  clockInExempt: boolean;
  landingPath: string | null;
  isHr: boolean;
  /** Off = the account is switched off (0091). */
  active: boolean;
  /** This person's own overrides of the role grid (0091). */
  overrides: Overrides;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [exempt, setExempt] = React.useState(clockInExempt);
  const [landing, setLanding] = React.useState(landingPath ?? ROLE_DEFAULT);
  const [hr, setHr] = React.useState(isHr);
  const [mainRole, setMainRole] = React.useState<Role>(role);
  const [extras, setExtras] = React.useState<Role[]>(extraRoles);
  const [saving, setSaving] = React.useState(false);
  const [on, setOn] = React.useState(active);
  const [pin, setPin] = React.useState("");
  const [busyModule, setBusyModule] = React.useState<ModuleKey | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const { staffId: myId } = useRole();
  const isMe = myId === staffId;

  const { rows: accessRows } = useModuleAccess();
  // Home-page choices follow the roles being set, not the ones saved, with this person's overrides.
  const choices = landingChoicesFor([mainRole, ...extras], accessRows, overrides);
  const sameRoles = mainRole === role && extras.length === extraRoles.length && extras.every((r) => extraRoles.includes(r));
  const pinOk = pin === "" || /^\d{6}$/.test(pin);
  const changed = exempt !== clockInExempt || (landing === ROLE_DEFAULT ? null : landing) !== landingPath || hr !== isHr || !sameRoles || on !== active || pin !== "";
  // Super Admin is only ever a main role; CEO only beside it (the server refuses otherwise).
  const extraChoices = extraRoleChoices(mainRole, extraRoles);

  function reset() {
    setExempt(clockInExempt);
    setLanding(landingPath ?? ROLE_DEFAULT);
    setHr(isHr);
    setMainRole(role);
    setExtras(extraRoles);
    setOn(active);
    setPin("");
  }

  async function changeOverride(module: ModuleKey, next: string) {
    setBusyModule(module);
    const result = await setStaffOverride({ staffId, module, level: next === ROLE_LEVEL ? null : (next as AccessLevel) });
    setBusyModule(null);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't save.");
      return;
    }
    toast.success(`${PERSON_MODULES.find((n) => n.module === module)?.title}: ${next === ROLE_LEVEL ? "as their roles" : LEVEL_LABEL[next as AccessLevel]}`);
    router.refresh();
  }

  async function handleRemove() {
    setSaving(true);
    const result = await deleteStaffAccount(staffId);
    setSaving(false);
    setConfirmRemove(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't remove the account.");
      return;
    }
    toast.success(`${name} removed.`);
    setOpen(false);
    router.refresh();
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
      active: on,
      temporaryPin: pin || null,
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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

          {mainRole !== "admin" ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Only for this person</legend>
              <p className="text-xs text-muted-foreground">
                Their roles decide what they can open (Roles &amp; Access). Raise or lower one module here for this person alone; it applies at once.
              </p>
              <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {PERSON_MODULES.map((item) => {
                  const own = overrides[item.module];
                  const fromRoles = levelFor(accessRows, [mainRole, ...extras], item.module);
                  const options: AccessLevel[] = item.viewOnly ? ["none", "view"] : ["none", "view", "edit"];
                  return (
                    <div key={item.module} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-sm">{item.title}</span>
                      <Select value={own ?? ROLE_LEVEL} disabled={saving || busyModule === item.module} onValueChange={(v) => changeOverride(item.module, v)}>
                        <SelectTrigger size="sm" className="w-[210px] pl-3 pr-2" aria-label={`${item.title} for ${name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ROLE_LEVEL}>As their roles ({LEVEL_LABEL[fromRoles]})</SelectItem>
                          {options.map((o) => (
                            <SelectItem key={o} value={o}>
                              {LEVEL_LABEL[o]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Account</legend>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">Account is on</span>
                <span className="text-xs text-muted-foreground">Off closes it at once and keeps every record. Switch it back on any time.</span>
              </div>
              <Switch checked={on} onCheckedChange={setOn} disabled={saving || isMe} aria-label="Account is on" />
            </div>
            <Field>
              <FieldLabel htmlFor="new-pin">New temporary PIN (optional)</FieldLabel>
              <Input
                id="new-pin"
                inputMode="numeric"
                maxLength={6}
                placeholder="6 digits"
                value={pin}
                aria-invalid={!pinOk}
                disabled={saving}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
              <p className="text-xs text-muted-foreground">Leave empty to keep their PIN. With a new one, they choose their own at the next sign-in.</p>
            </Field>
            {!isMe ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  Remove only an account made by mistake: one that has any record (a clock-in, a trip, a receipt) is refused. Switch it off instead.
                </span>
                <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5 text-destructive" disabled={saving} onClick={() => setConfirmRemove(true)}>
                  <Trash2 className="size-3.5" />
                  Remove account
                </Button>
              </div>
            ) : null}
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!changed || saving || !pinOk}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {name}&rsquo;s account?</AlertDialogTitle>
            <AlertDialogDescription>
              The login is deleted for good. If the account has any record, the system refuses and nothing changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} disabled={saving} variant="destructive">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
