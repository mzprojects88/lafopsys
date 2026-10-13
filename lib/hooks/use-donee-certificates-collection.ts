"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { DoneeCertificate, DoneeCertStatus, DonationKind } from "@/lib/types/donor";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface DoneeCertificateRow {
  id: string;
  donation_id: string;
  control_number: string;
  status: DoneeCertStatus;
  requested_at: string;
  released_at: string | null;
  kind: DonationKind | null;
  amount: number | string | null;
  description: string | null;
  signatory_id: string | null;
  released_by: string | null;
}

function toDoneeCertificate(row: DoneeCertificateRow): DoneeCertificate {
  return {
    id: row.id,
    donationId: row.donation_id,
    controlNumber: row.control_number,
    status: row.status,
    requestedAt: row.requested_at,
    releasedAt: row.released_at ?? undefined,
    kind: row.kind ?? undefined,
    amount: row.amount == null ? undefined : Number(row.amount),
    description: row.description ?? undefined,
    signatoryId: row.signatory_id ?? undefined,
    releasedBy: row.released_by ?? undefined,
  };
}

export const doneeCertificatesStore = createCollection<DoneeCertificate[]>({
  key: "ops.donee_certificates",
  empty: [],
  tables: [{ schema: "ops", table: "donee_certificates" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("donee_certificates").select("*").order("requested_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toDoneeCertificate);
  },
});

/** Control numbers come from the database series (0085); the browser requests and advances, never writes. */
export function useDoneeCertificatesData() {
  const { data: certificates, loading } = useCollection(doneeCertificatesStore);

  async function requestCertificate(donationId: string): Promise<MutationResult & { number?: string }> {
    const { data, error } = await createClient().schema("ops").rpc("request_donee_certificate", { p_donation: donationId });
    if (error) return { ok: false, error: error.message };
    await doneeCertificatesStore.refetch();
    return { ok: true, number: data as string };
  }

  async function advanceStatus(id: string): Promise<MutationResult & { status?: DoneeCertStatus }> {
    const { data, error } = await createClient().schema("ops").rpc("advance_donee_certificate", { p_id: id });
    if (error) return { ok: false, error: error.message };
    await doneeCertificatesStore.refetch();
    return { ok: true, status: data as DoneeCertStatus };
  }

  return { certificates, loading, requestCertificate, advanceStatus, refetch: doneeCertificatesStore.refetch };
}
