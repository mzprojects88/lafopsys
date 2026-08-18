"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { Volunteer } from "@/lib/types/staff";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface VolunteerRow {
  id: string;
  first_name: string;
  last_name: string;
  focus_area: Volunteer["focusArea"];
  total_hours: number;
  last_session_date: string | null;
  certificates_issued: number;
}

function toVolunteer(row: VolunteerRow): Volunteer {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    focusArea: row.focus_area,
    totalHours: row.total_hours,
    lastSessionDate: row.last_session_date ?? "",
    certificatesIssued: row.certificates_issued,
  };
}

/** Real ops.volunteers -- starts empty. lib/mock-data/staff.ts's volunteers
 * array is fixed demo data (names/hours/certs) with no real source file, so
 * it wasn't migrated -- staff add real volunteers going forward. */
export function useVolunteersData() {
  const [volunteers, setVolunteers] = React.useState<Volunteer[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("volunteers").select("*").order("first_name");
    setVolunteers((data ?? []).map(toVolunteer));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function addVolunteer(volunteer: Omit<Volunteer, "id">): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("volunteers").insert({
      id: crypto.randomUUID(),
      first_name: volunteer.firstName,
      last_name: volunteer.lastName,
      focus_area: volunteer.focusArea,
      total_hours: volunteer.totalHours,
      last_session_date: volunteer.lastSessionDate || null,
      certificates_issued: volunteer.certificatesIssued,
    });
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function incrementCertificates(id: string, current: number): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("volunteers").update({ certificates_issued: current + 1 }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { volunteers, loading, addVolunteer, incrementCertificates, refetch };
}
