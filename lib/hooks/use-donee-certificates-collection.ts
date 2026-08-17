"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { DoneeCertificate, DoneeCertStatus } from "@/lib/types/donor";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface DoneeCertificateRow {
  id: string;
  donation_id: string;
  control_number: string;
  status: DoneeCertStatus;
  requested_at: string;
  released_at: string | null;
}

function toDoneeCertificate(row: DoneeCertificateRow): DoneeCertificate {
  return {
    id: row.id,
    donationId: row.donation_id,
    controlNumber: row.control_number,
    status: row.status,
    requestedAt: row.requested_at,
    releasedAt: row.released_at ?? undefined,
  };
}

export function useDoneeCertificatesData() {
  const [certificates, setCertificates] = React.useState<DoneeCertificate[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("donee_certificates").select("*").order("requested_at", { ascending: false });
    setCertificates((data ?? []).map(toDoneeCertificate));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function generateCertificate(donationId: string): Promise<MutationResult> {
    const supabase = createClient();
    const controlNumber = `DC-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const { error } = await supabase.schema("ops").from("donee_certificates").insert({
      id: crypto.randomUUID(),
      donation_id: donationId,
      control_number: controlNumber,
      status: "requested",
      requested_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function advanceStatus(id: string, nextStatus: DoneeCertStatus): Promise<MutationResult> {
    const supabase = createClient();
    const row: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === "released") row.released_at = new Date().toISOString();
    const { error } = await supabase.schema("ops").from("donee_certificates").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { certificates, loading, generateCertificate, advanceStatus, refetch };
}
