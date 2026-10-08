"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Gift, Wallet, TrendingUp, Plus, Receipt, Award, Megaphone, UserPlus, Sparkles } from "lucide-react";
import { useDonorSuggestions } from "@/lib/hooks/use-donor-suggestions";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Button } from "@/components/ui/button";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useDonorPledgesData } from "@/lib/hooks/use-donor-pledges-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { DonorFormDialog } from "@/components/modules/donors/donor-form-dialog";
import type { Donor, DonorType } from "@/lib/types/donor";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { isVipEligible } from "@/lib/utils/donor-vip";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/donors/receipts", label: "Receipts", icon: Receipt },
  { href: "/donors/donee-certs", label: "Donee Certs", icon: Award },
  { href: "/donors/campaigns", label: "Campaigns", icon: Megaphone },
];

function buildColumns(pledges: import("@/lib/types/donor").DonorPledge[]): ColumnDef<Donor>[] {
  return [
    {
      accessorKey: "name",
      header: "Donor",
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <PersonAvatar name={row.original.name} size="sm" />
          <span className="font-medium">{row.original.name}</span>
          {isVipEligible(row.original, pledges) && (
            <span className={`rounded-full px-2 py-0.5 text-theme-xs font-medium ${STATUS_TONE_CLASSES.info}`}>
              VIP
            </span>
          )}
        </div>
      ),
    },
    { accessorKey: "type", header: "Type", cell: ({ row }) => <span className="capitalize">{row.original.type}</span> },
    { accessorKey: "taxJurisdiction", header: "Jurisdiction" },
    { accessorKey: "giftCount", header: "Gifts" },
    {
      accessorKey: "lifetimeValue",
      header: "Lifetime Value",
      cell: ({ row }) => formatCurrency(row.original.lifetimeValue),
    },
    {
      accessorKey: "lastGiftDate",
      header: "Last Gift",
      cell: ({ row }) => formatDate(row.original.lastGiftDate),
    },
  ];
}

type FilterKey = DonorType | "vip" | "all";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "vip", label: "VIP" },
  { key: "individual", label: "Individual" },
  { key: "corporate", label: "Corporate" },
  { key: "foundation", label: "Foundation" },
  { key: "government", label: "Government" },
  { key: "anonymous", label: "Anonymous" },
];

export default function DonorsPage() {
  const router = useRouter();
  const { donors: all } = useDonorsData();
  const { pledges } = useDonorPledgesData();
  const { canEdit } = useModuleAccess();
  const editor = canEdit("donors");
  const { suggestions } = useDonorSuggestions();
  const [adding, setAdding] = React.useState(false);
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const columns = React.useMemo(() => buildColumns(pledges), [pledges]);
  const pick = (key: FilterKey) => (key === "all" ? all : key === "vip" ? all.filter((d) => isVipEligible(d, pledges)) : all.filter((d) => d.type === key));
  const donors = pick(filter);
  const totalGifts = donors.reduce((sum, d) => sum + d.giftCount, 0);
  const totalLifetimeValue = donors.reduce((sum, d) => sum + d.lifetimeValue, 0);
  const avgGift = totalGifts > 0 ? totalLifetimeValue / totalGifts : 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Donors & Donations"
        description="Everyone who has given to LAF. Gifts logged in LAF Inventory count here too."
        action={
          <>
            {editor && (
              <>
                <Button variant="outline" asChild>
                  <Link href="/donors/cleanup"><Sparkles />Clean-up{suggestions.length ? ` (${suggestions.length})` : ""}</Link>
                </Button>
                <Button variant="outline" onClick={() => setAdding(true)}><UserPlus />Add donor</Button>
                <Button asChild><Link href="/donors/intake"><Plus />New Donation</Link></Button>
              </>
            )}
            <ModuleSubNav items={SUB_NAV} />
          </>
        }
      />
      {editor && <DonorFormDialog open={adding} onOpenChange={setAdding} />}

      <KpiGrid>
        <KpiCard label="Total Donors" value={donors.length} icon={Users} />
        <KpiCard label="Total Gifts" value={totalGifts} icon={Gift} />
        <KpiCard label="Lifetime Value" value={formatCurrency(totalLifetimeValue)} icon={Wallet} />
        <KpiCard label="Avg Gift" value={formatCurrency(avgGift)} icon={TrendingUp} />
      </KpiGrid>

      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Show donors">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className="shrink-0 rounded-full border border-border px-3 py-1 text-theme-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
          >
            {f.label} <span className="tabular-nums">{pick(f.key).length}</span>
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={donors}
        searchPlaceholder="Search donors…"
        onRowClick={(d) => router.push(`/donors/${d.id}`)}
      />
    </div>
  );
}
