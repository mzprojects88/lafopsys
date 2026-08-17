"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useAcknowledgmentReceiptsData } from "@/lib/hooks/use-acknowledgment-receipts-collection";
import { useDoneeCertificatesData } from "@/lib/hooks/use-donee-certificates-collection";
import type { AcknowledgmentReceipt, DoneeCertificate, Donation, Donor } from "@/lib/types/donor";

function buildArColumns(donations: Donation[], donors: Donor[]): ColumnDef<AcknowledgmentReceipt>[] {
  return [
    { accessorKey: "sequenceNumber", header: "Sequence #" },
    {
      id: "donor",
      header: "Donor",
      cell: ({ row }) => {
        const donation = donations.find((d) => d.id === row.original.donationId);
        return donors.find((d) => d.id === donation?.donorId)?.name ?? "—";
      },
    },
    { accessorKey: "entity", header: "Entity", cell: ({ row }) => (row.original.entity === "US_501C3" ? "US" : "PH") },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge domain="ar" status={row.original.status} /> },
  ];
}

function buildCertColumns(donations: Donation[], donors: Donor[]): ColumnDef<DoneeCertificate>[] {
  return [
    { accessorKey: "controlNumber", header: "Control #" },
    {
      id: "donor",
      header: "Donor",
      cell: ({ row }) => {
        const donation = donations.find((d) => d.id === row.original.donationId);
        return donors.find((d) => d.id === donation?.donorId)?.name ?? "—";
      },
    },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge domain="doneeCert" status={row.original.status} /> },
    { accessorKey: "releasedAt", header: "Released", cell: ({ row }) => row.original.releasedAt ?? "—" },
  ];
}

export default function RegistersPage() {
  const { donations, donors } = useDonorsData();
  const { receipts } = useAcknowledgmentReceiptsData();
  const { certificates } = useDoneeCertificatesData();
  const arColumns = buildArColumns(donations, donors);
  const certColumns = buildCertColumns(donations, donors);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="AR / Donee Cert Registers" description="Sequential numbering with gap detection — shared with the Donors module." />
      <Tabs defaultValue="ar">
        <TabsList>
          <TabsTrigger value="ar">Acknowledgment Receipts</TabsTrigger>
          <TabsTrigger value="cert">Donee Certificates</TabsTrigger>
        </TabsList>
        <TabsContent value="ar" className="pt-4">
          <DataTable columns={arColumns} data={receipts} searchPlaceholder="Search AR register…" />
        </TabsContent>
        <TabsContent value="cert" className="pt-4">
          <DataTable columns={certColumns} data={certificates} searchPlaceholder="Search Donee Cert register…" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
