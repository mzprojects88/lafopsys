"use client";

import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { SectionCard } from "@/components/patterns/section-card";
import { Checkbox } from "@/components/ui/checkbox";
import { useCollection } from "@/lib/data/collection-store";
import { dashboardProfilesStore, setProfileCard } from "@/lib/hooks/use-dashboard";
import { rolesStore } from "@/lib/hooks/use-module-access";
import { useRole } from "@/lib/rbac/use-role";
import { CARDS } from "@/lib/utils/dashboard-catalog";

/**
 * Settings › Dashboard profiles (0147): the cards each role may have on its dashboard, set by the Super Admin. Each
 * person then switches their own on and off. The database gives a money figure only to a role ticked here (and to
 * the Super Admin, who has every card).
 */
export default function DashboardProfilesPage() {
  const { roles: mine } = useRole();
  const { data: roles } = useCollection(rolesStore);
  const { data: rows } = useCollection(dashboardProfilesStore);
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!mine.includes("admin")) return <EmptyState title="The Super Admin sets the dashboard profiles" description="Ask the Super Admin to change which cards a role may have." />;

  const shown = roles.filter((r) => !r.archived_at && r.key !== "admin" && r.key !== "partner_viewer");
  const has = new Set(rows.map((r) => `${r.role}|${r.card}`));
  async function toggle(role: string, card: string, on: boolean) {
    setBusy(`${role}|${card}`);
    const error = await setProfileCard(role, card, on);
    setBusy(null);
    if (error) toast.error(error);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Dashboard profiles" description="Which cards each role may have on its dashboard. Each person then switches theirs on and off and puts them in their own order." />
      <SectionCard flush title="Cards by role" description="The money cards (₱) are figures only for the roles ticked here; the Super Admin has every card.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-theme-sm">
            <thead>
              <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                <th className="sticky left-0 h-10 bg-card px-4 font-medium">Card</th>
                {shown.map((r) => <th key={r.key} className="h-10 px-2 text-center font-medium">{r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {CARDS.map((c) => (
                <tr key={c.key} className="border-b border-border last:border-0">
                  <td className="sticky left-0 bg-card px-4 py-2">
                    {c.title}
                    {c.money ? <span className="ml-1 text-theme-xs text-muted-foreground">₱</span> : null}
                    {c.main ? null : <span className="ml-1 text-theme-xs text-muted-foreground">(extra)</span>}
                  </td>
                  {shown.map((r) => {
                    const k = `${r.key}|${c.key}`;
                    return (
                      <td key={r.key} className="px-2 py-2 text-center">
                        <Checkbox checked={has.has(k)} disabled={busy === k} aria-label={`${r.name}: ${c.title}`} onCheckedChange={(v) => void toggle(r.key, c.key, v === true)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
