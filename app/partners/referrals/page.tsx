"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { referrals as seedReferrals } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import { useHospitalAuth } from "@/context/hospital-auth-provider";
import type { Referral } from "@/lib/types/patient";
import { formatDate } from "@/lib/utils/date";

const columns: ColumnDef<Referral>[] = [
  { accessorKey: "patientName", header: "Patient" },
  { accessorKey: "referringPerson", header: "Referred By" },
  {
    id: "date",
    header: "Date",
    accessorFn: (r) => r.date,
    cell: ({ row }) => formatDate(row.original.date),
  },
  {
    id: "urgency",
    header: "Urgency",
    cell: ({ row }) => <span className="capitalize">{row.original.urgency}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge domain="referral" status={row.original.status} />,
  },
  {
    id: "reason",
    header: "Note",
    cell: ({ row }) => row.original.reason ?? "—",
  },
];

export default function PartnerReferralsPage() {
  const { session } = useHospitalAuth();
  const { items } = useLocalCollection<Referral>("referrals", seedReferrals);
  const ours = items
    .filter((r) => r.hospitalId === session?.hospitalId)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Our Referrals" description="Every referral your hospital has submitted to LAF House, and its current status." />
      <DataTable columns={columns} data={ours} searchPlaceholder="Search referrals…" emptyMessage="No referrals submitted yet." />
    </div>
  );
}
