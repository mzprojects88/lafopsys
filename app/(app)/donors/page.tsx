"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Gift, Wallet, TrendingUp, Plus, Receipt, Award, Megaphone } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { Button } from "@/components/ui/button";
import { donors } from "@/lib/mock-data";
import type { Donor } from "@/lib/types/donor";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";

const SUB_NAV: ModuleSubNavItem[] = [
  { href: "/donors/receipts", label: "Receipts", icon: Receipt, color: "blue" },
  { href: "/donors/donee-certs", label: "Donee Certs", icon: Award, color: "green" },
  { href: "/donors/campaigns", label: "Campaigns", icon: Megaphone, color: "rose" },
];

const columns: ColumnDef<Donor>[] = [
  {
    accessorKey: "name",
    header: "Donor",
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <PersonAvatar name={row.original.name} size="sm" />
        <span className="font-medium">{row.original.name}</span>
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

export default function DonorsPage() {
  const router = useRouter();
  const totalGifts = donors.reduce((sum, d) => sum + d.giftCount, 0);
  const totalLifetimeValue = donors.reduce((sum, d) => sum + d.lifetimeValue, 0);
  const avgGift = totalGifts > 0 ? totalLifetimeValue / totalGifts : 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Donors & Donations"
        description="Unified from In-kind Donations and DonorsVisitors Information."
        action={
          <>
            <Button asChild><Link href="/donors/intake"><Plus />New Donation</Link></Button>
            <ModuleSubNav items={SUB_NAV} />
          </>
        }
      />

      <KpiGrid>
        <KpiCard label="Total Donors" value={donors.length} icon={Users} color="rose" />
        <KpiCard label="Total Gifts" value={totalGifts} icon={Gift} color="blue" />
        <KpiCard label="Lifetime Value" value={formatCurrency(totalLifetimeValue)} icon={Wallet} color="green" />
        <KpiCard label="Avg Gift" value={formatCurrency(avgGift)} icon={TrendingUp} color="amber" />
      </KpiGrid>

      <DataTable
        columns={columns}
        data={donors}
        searchPlaceholder="Search donors…"
        onRowClick={(d) => router.push(`/donors/${d.id}`)}
      />
    </div>
  );
}
