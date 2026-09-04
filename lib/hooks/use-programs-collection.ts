"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
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
export const programsStore = createCollection<Program[]>({
  key: "ops.programs",
  empty: [],
  tables: [{ schema: "ops", table: "programs" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("programs").select("*").order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map(toProgram);
  },
});

export function useProgramsData() {
  const { data: programs, loading } = useCollection(programsStore);

  return { programs, loading, refetch: programsStore.refetch };
}
