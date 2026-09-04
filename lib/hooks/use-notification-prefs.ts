"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollectionFamily, useCollection } from "@/lib/data/collection-store";
import { useRole } from "@/context/role-provider";

export type MutationResult = { ok: true } | { ok: false; error: string };

/** Real per-staff notification preferences, stored on shared.staff.notification_prefs
 * (jsonb) for the currently authenticated user. Delivery (email digest, SMS) is not
 * built -- no email/SMS provider is wired into this app -- this only makes the
 * on/off preference itself durable instead of resetting on every reload. */
const notificationPrefs = createCollectionFamily<Record<string, boolean>>({
  key: "shared.staff.notification_prefs",
  empty: {},
  tables: () => [{ schema: "shared", table: "staff" }],
  fetch: async (staffId) => {
    const { data, error } = await createClient()
      .schema("shared")
      .from("staff")
      .select("notification_prefs")
      .eq("id", staffId)
      .single();
    if (error) throw new Error(error.message);
    return (data?.notification_prefs as Record<string, boolean> | null) ?? {};
  },
});

const NO_PREFS: Record<string, boolean> = {};
const noRefetch = async () => {};

export function useNotificationPrefs() {
  const { staffId } = useRole();
  const store = staffId ? notificationPrefs.get(staffId) : null;
  const snapshot = useCollection(store);
  const prefs = store ? snapshot.data : NO_PREFS;
  // Unresolved identity counts as loading; "no session" does not.
  const loading = staffId === undefined || (store !== null && snapshot.loading);

  async function setPref(id: string, value: boolean): Promise<MutationResult> {
    if (!staffId || !store) return { ok: false, error: "No authenticated staff session." };
    const next = { ...prefs, [id]: value };
    const supabase = createClient();
    const { error } = await supabase.schema("shared").from("staff").update({ notification_prefs: next }).eq("id", staffId);
    if (error) return { ok: false, error: error.message };
    await store.refetch();
    return { ok: true };
  }

  return { prefs, loading, setPref, refetch: store ? store.refetch : noRefetch };
}
