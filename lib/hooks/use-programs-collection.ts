"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { Program } from "@/lib/types/reference";

interface ProgramRow {
  id: string;
  name: string;
  description: string | null;
}

function toProgram(row: ProgramRow): Program {
  return { id: row.id, name: row.name as Program["name"], description: row.description ?? "" };
}

/** Real `ops.programs` reference data -- the 6-item LAF program taxonomy. */
export function useProgramsData() {
  const [programs, setPrograms] = React.useState<Program[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("programs").select("*").order("name");
    setPrograms((data ?? []).map(toProgram));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  return { programs, loading, refetch };
}
