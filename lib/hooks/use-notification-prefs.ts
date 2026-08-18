"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";

export type MutationResult = { ok: true } | { ok: false; error: string };

/** Real per-staff notification preferences, stored on shared.staff.notification_prefs
 * (jsonb) for the currently authenticated user. Delivery (email digest, SMS) is not
 * built -- no email/SMS provider is wired into this app -- this only makes the
 * on/off preference itself durable instead of resetting on every reload. */
export function useNotificationPrefs() {
  const [prefs, setPrefs] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState(true);
  const [staffId, setStaffId] = React.useState<string | undefined>(undefined);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setLoading(false);
      return;
    }
    setStaffId(userData.user.id);
    const { data } = await supabase
      .schema("shared")
      .from("staff")
      .select("notification_prefs")
      .eq("id", userData.user.id)
      .single();
    setPrefs((data?.notification_prefs as Record<string, boolean>) ?? {});
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function setPref(id: string, value: boolean): Promise<MutationResult> {
    if (!staffId) return { ok: false, error: "No authenticated staff session." };
    const next = { ...prefs, [id]: value };
    const supabase = createClient();
    const { error } = await supabase.schema("shared").from("staff").update({ notification_prefs: next }).eq("id", staffId);
    if (error) return { ok: false, error: error.message };
    setPrefs(next);
    return { ok: true };
  }

  return { prefs, loading, setPref };
}
