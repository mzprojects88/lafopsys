"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";

/** The expense purposes in Settings › Executive summary (0114), in their order. Read once per mount: they change a few times a year. */
export function useExpensePurposes(): string[] {
  const [purposes, setPurposes] = React.useState<string[]>([]);
  React.useEffect(() => {
    void createClient()
      .schema("shared")
      .from("app_settings")
      .select("exec_summary")
      .eq("id", true)
      .maybeSingle()
      .then(({ data }) => setPurposes(((data?.exec_summary as { purposes?: string[] } | null)?.purposes ?? []).filter(Boolean)));
  }, []);
  return purposes;
}
