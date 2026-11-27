"use client";

import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DirectDonations } from "@/components/modules/patients/direct-donations";
import { DirectScanner } from "@/components/modules/patients/direct-scanner";
import { PatientsSubNav } from "@/components/modules/patients/patients-subnav";
import { useRole } from "@/context/role-provider";
import { fileNameFromHeader } from "@/lib/utils/ar-file-name";

/**
 * Patients > Direct donations (Inventory 0082): goods a donor gave for the patients themselves, under their own AR
 * series (LAF-DTP). The same screen and the same database calls as LAF Inventory's "Direct to patient": received here
 * or there, given one share per child by scanning the Patient ID card. The database decides who may do what; the roles
 * here only show or hide the buttons.
 */
async function downloadAr({ id, arNumber }: { id: string; arNumber: string }) {
  const res = await fetch("/api/direct/ar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ donationId: id }) }).catch(() => null);
  if (!res?.ok) {
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    return void toast.error(body?.error ?? "Couldn't make the AR.");
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileNameFromHeader(res.headers.get("content-disposition"), `${arNumber}.pdf`);
  a.click();
  URL.revokeObjectURL(url);
}

export default function DirectDonationsPage() {
  const { roles, user } = useRole();
  const has = (...r: string[]) => roles.some((x) => r.includes(x));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Direct donations"
        description="Donations for the patients themselves: receive them, give each child their share by scanning the ID card, and follow how much is given."
        action={<PatientsSubNav except="/patients/direct" />}
      />
      <DirectDonations
        staffName={user}
        canGive={has("admin", "office_admin", "ceo", "social_worker", "inventory_lead", "inventory_staff")}
        canByName={has("admin", "office_admin", "social_worker")}
        canUndo={has("admin", "inventory_lead")}
        Scanner={DirectScanner}
        onDownloadAr={(d) => void downloadAr(d)}
      />
    </div>
  );
}
