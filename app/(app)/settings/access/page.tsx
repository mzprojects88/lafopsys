"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronDown, Plus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OUTSIDE_AREAS, rolesStore, useModuleAccess, useRoleNames, type OutsideArea } from "@/lib/hooks/use-module-access";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useRole } from "@/context/role-provider";
import { createClient } from "@/lib/supabase/client";
import { NAV_ITEMS, PARTNER_ROLES, holdsPower, type AccessLevel } from "@/lib/rbac/roles";
import { PAGES, POWERS, VIEW_ONLY_MODULES, type PageDef } from "@/lib/rbac/pages";
import type { Role } from "@/lib/types/common";
import { cn } from "@/lib/utils";

const LEVEL_LABEL: Record<AccessLevel, string> = { none: "None", view: "View only", edit: "Edit" };
const MIXED = "__mixed__";

/**
 * Settings -> Roles & Access (0093): create a role, set its level page by page, give it powers,
 * see who holds it. The menu level the database enforces follows the highest page (a trigger);
 * the app hides and refuses pages at None and removes buttons at View. The Super Admin has every
 * page and power; Settings stays with them. Outside (partner) accounts keep their own section.
 */
export default function AccessPage() {
  const { role } = useRole();
  const { roles, name: roleName } = useRoleNames();
  const { pageRows, powers, setPageLevel, setPower, setOutsideLevel, outsideLevel } = useModuleAccess();
  const { staff } = useStaffRoster();
  const [selected, setSelected] = React.useState<string>("social_worker");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [open, setOpen] = React.useState<Set<string>>(new Set());

  const staffRoles = roles.filter((r) => !PARTNER_ROLES.includes(r.key) && !r.archived_at);
  const current = staffRoles.find((r) => r.key === selected) ?? staffRoles[0];
  const holders = current ? staff.filter((s) => s.active && (s.role === current.key || s.extraRoles.includes(current.key))) : [];
  const isAdminRole = current?.key === "admin";

  const levelOf = (page: PageDef): AccessLevel =>
    isAdminRole ? "edit" : ((pageRows.find((r) => r.role === current?.key && r.page === page.key)?.level as AccessLevel | undefined) ?? "none");

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(key);
    const result = await fn();
    setBusy(null);
    if (!result.ok) toast.error(`Couldn't save: ${result.error}`);
    else toast.success(done);
  }

  async function archive() {
    if (!current) return;
    const { error } = await createClient().schema("shared").from("roles").update({ archived_at: new Date().toISOString() }).eq("key", current.key);
    if (error) {
      toast.error(error.message);
      return;
    }
    await rolesStore.refetch();
    toast.success(`${current.name} archived`);
    setSelected("social_worker");
  }

  if (role !== "admin") return null;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Roles & Access"
        description="Create a role, choose what it can open page by page, then give it to people under Manage Users. Changes apply at once."
        action={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> New role
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Roles" className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
          {staffRoles.map((r) => {
            const count = staff.filter((s) => s.active && (s.role === r.key || s.extraRoles.includes(r.key))).length;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => setSelected(r.key)}
                className={cn(
                  "flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-left text-theme-sm last:border-0 hover:bg-muted/60",
                  current?.key === r.key && "bg-muted font-medium"
                )}
              >
                <span className="min-w-0 truncate">{r.name}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-theme-xs text-muted-foreground">
                  {!r.built_in && <Badge variant="secondary">Created</Badge>}
                  {count}
                </span>
              </button>
            );
          })}
        </nav>

        {current && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-base font-medium text-foreground">{current.name}</h2>
                {current.description && <p className="text-theme-sm text-muted-foreground">{current.description}</p>}
                <p className="text-theme-xs text-muted-foreground">
                  {holders.length ? `Held by ${holders.map((s) => `${s.firstName} ${s.lastName}`).join(", ")}.` : "Nobody holds this role yet."}
                  {!current.built_in && " Created roles open this system only; the Inventory app follows in a later step."}
                </p>
              </div>
              {!current.built_in && (
                <Button variant="outline" size="sm" onClick={archive} disabled={holders.length > 0} title={holders.length ? "Give its people another role first" : undefined}>
                  Archive role
                </Button>
              )}
            </div>

            {isAdminRole ? (
              <p className="rounded-2xl border border-border bg-card px-5 py-4 text-theme-sm text-muted-foreground">
                The Super Admin opens every page with Edit and holds every power, including Settings.
              </p>
            ) : (
              <>
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="border-b border-border px-5 py-3">
                    <h3 className="text-theme-sm font-medium text-foreground">Pages</h3>
                    <p className="text-theme-xs text-muted-foreground">
                      Page levels decide what people see and can change on screen; the database protects each menu as a whole, at its highest page.
                    </p>
                  </div>
                  {NAV_ITEMS.filter((n) => !n.adminOnly).map((item) => {
                    const pages = PAGES.filter((p) => p.module === item.module);
                    const levelled = pages.filter((p) => !p.power);
                    const levels = new Set(levelled.map(levelOf));
                    const menuValue = levels.size === 1 ? [...levels][0]! : MIXED;
                    const options: AccessLevel[] = VIEW_ONLY_MODULES.includes(item.module) ? ["none", "view"] : ["none", "view", "edit"];
                    const expanded = open.has(item.module);
                    return (
                      <div key={item.module} className="border-b border-border last:border-0">
                        <div className="flex items-center gap-3 px-5 py-2.5">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left text-theme-sm font-medium text-foreground"
                            onClick={() => setOpen((prev) => (prev.has(item.module) ? new Set([...prev].filter((m) => m !== item.module)) : new Set([...prev, item.module])))}
                            aria-expanded={expanded}
                          >
                            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")} />
                            {item.title}
                            <span className="text-theme-xs font-normal text-muted-foreground">{pages.length} pages</span>
                          </button>
                          <Select
                            value={menuValue}
                            disabled={busy !== null}
                            onValueChange={(v) =>
                              run(item.module, () => setPageLevel(current.key as Role, levelled.map((p) => p.key), v as AccessLevel), `${current.name} · ${item.title}: every page ${LEVEL_LABEL[v as AccessLevel]}`)
                            }
                          >
                            <SelectTrigger size="sm" className="w-[130px] pl-3 pr-2" aria-label={`${item.title}, every page, for ${current.name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {menuValue === MIXED && <SelectItem value={MIXED} disabled>Mixed</SelectItem>}
                              {options.map((o) => (
                                <SelectItem key={o} value={o}>
                                  {LEVEL_LABEL[o]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {expanded &&
                          pages.map((page) => (
                            <div key={page.key} className="flex items-center gap-3 border-t border-border/60 bg-muted/30 py-2 pl-12 pr-5">
                              <span className="min-w-0 flex-1 text-theme-sm text-foreground">{page.title}</span>
                              {page.power ? (
                                <span className="text-theme-xs text-muted-foreground">Follows “{POWERS.find((x) => x.key === page.power)?.title}”</span>
                              ) : (
                                <Select
                                  value={levelOf(page)}
                                  disabled={busy !== null}
                                  onValueChange={(v) => run(page.key, () => setPageLevel(current.key as Role, [page.key], v as AccessLevel), `${current.name} · ${page.title}: ${LEVEL_LABEL[v as AccessLevel]}`)}
                                >
                                  <SelectTrigger size="sm" className="w-[130px] pl-3 pr-2" aria-label={`${page.title} for ${current.name}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {options.map((o) => (
                                      <SelectItem key={o} value={o}>
                                        {LEVEL_LABEL[o]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          ))}
                      </div>
                    );
                  })}
                </div>

                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="border-b border-border px-5 py-3">
                    <h3 className="text-theme-sm font-medium text-foreground">Powers</h3>
                    <p className="text-theme-xs text-muted-foreground">What this role may do beyond its pages. The database checks each one.</p>
                  </div>
                  {POWERS.map((p) => {
                    const on = holdsPower([current.key], p.key, powers.length ? powers : undefined);
                    return (
                      <div key={p.key} className="flex items-center justify-between gap-4 border-b border-border px-5 py-3 last:border-0">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-theme-sm text-foreground">{p.title}</span>
                          <span className="text-theme-xs text-muted-foreground">{p.note}</span>
                        </div>
                        <Switch
                          checked={on}
                          disabled={busy !== null}
                          aria-label={`${p.title} for ${current.name}`}
                          onCheckedChange={(next) => run(p.key, () => setPower(current.key as Role, p.key, next), `${current.name} · ${p.title}: ${next ? "on" : "off"}`)}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium text-foreground">Inventory app: outside accounts</h2>
          <p className="max-w-[75ch] text-theme-sm text-muted-foreground">
            An outside account (a partner’s representative, created under Manage Users) signs in to the Inventory app only. It can look at the areas
            turned on here and nothing else: it never edits, never clocks in, and cannot open this system.
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {OUTSIDE_AREAS.map((area) => (
            <div key={area.key} className="flex items-center justify-between gap-4 border-b border-border px-5 py-3 last:border-0">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-theme-sm font-medium text-foreground">{area.title}</span>
                <span className="text-theme-xs text-muted-foreground">{area.note}</span>
              </div>
              {PARTNER_ROLES.map((r) => (
                <Select
                  key={r}
                  value={outsideLevel(r, area.key)}
                  disabled={busy !== null}
                  onValueChange={(v) => run(`${r}|${area.key}`, () => setOutsideLevel(r, area.key as OutsideArea, v as "none" | "view"), `${roleName(r)} · ${area.title}: ${LEVEL_LABEL[v as AccessLevel]}`)}
                >
                  <SelectTrigger size="sm" className="w-[112px] pl-3 pr-2" aria-label={`${area.title} for ${roleName(r)}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{LEVEL_LABEL.none}</SelectItem>
                    <SelectItem value="view">{LEVEL_LABEL.view}</SelectItem>
                  </SelectContent>
                </Select>
              ))}
            </div>
          ))}
        </div>
      </div>

      <NewRoleDialog
        open={creating}
        onOpenChange={setCreating}
        copyChoices={staffRoles.filter((r) => r.key !== "admin")}
        onCreated={(key) => {
          setSelected(key);
          setCreating(false);
        }}
      />
    </div>
  );
}

function NewRoleDialog({
  open,
  onOpenChange,
  copyChoices,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copyChoices: { key: string; name: string }[];
  onCreated: (key: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [copyFrom, setCopyFrom] = React.useState("__none__");
  const [saving, setSaving] = React.useState(false);

  async function create() {
    setSaving(true);
    const { data, error } = await createClient()
      .schema("shared")
      .rpc("create_role", { p_name: name.trim(), p_description: description.trim() || null, p_copy_from: copyFrom === "__none__" ? null : copyFrom });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await rolesStore.refetch();
    toast.success(`Role “${name.trim()}” created`);
    setName("");
    setDescription("");
    setCopyFrom("__none__");
    onCreated(data as string);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>Name it, optionally start from another role&apos;s pages and powers, then adjust page by page.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="role-name">Name</FieldLabel>
          <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Relief Driver" autoFocus />
        </Field>
        <Field>
          <FieldLabel htmlFor="role-description">Description (optional)</FieldLabel>
          <Input id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who it is for" />
        </Field>
        <Field>
          <FieldLabel htmlFor="role-copy">Start from</FieldLabel>
          <Select value={copyFrom} onValueChange={setCopyFrom}>
            <SelectTrigger id="role-copy" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Nothing (every page None)</SelectItem>
              {copyChoices.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={create} disabled={saving || name.trim().length < 2}>
            {saving ? "Creating…" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
