"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface DonorAuthContextValue {
  donorId: string | null;
  donorName: string | null;
  mustChangePassword: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const DonorAuthContext = React.createContext<DonorAuthContextValue | undefined>(undefined);

/**
 * Parallel to, and deliberately separate from, context/role-provider.tsx --
 * a donor is not a staff Role and must never be mixed into that provider's
 * state. No localStorage fallback either: that fallback exists on the staff
 * side only for pre-ENFORCE_AUTH demo mode, which the donor portal has no
 * equivalent of.
 */
export function DonorAuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [donorId, setDonorId] = React.useState<string | null>(null);
  const [donorName, setDonorName] = React.useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        if (!cancelled) setLoading(false);
        return;
      }

      const { data: account } = await supabase
        .schema("shared")
        .from("donor_accounts")
        .select("donor_id, must_change_password")
        .eq("id", userData.user.id)
        .single();

      if (!account) {
        if (!cancelled) setLoading(false);
        return;
      }

      const { data: donor } = await supabase.schema("ops").from("donors").select("name").eq("id", account.donor_id).single();

      if (cancelled) return;
      setDonorId(account.donor_id);
      setMustChangePassword(account.must_change_password);
      setDonorName(donor?.name ?? null);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = React.useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/portal/login");
  }, [router]);

  const value = React.useMemo(
    () => ({ donorId, donorName, mustChangePassword, loading, signOut }),
    [donorId, donorName, mustChangePassword, loading, signOut]
  );

  return <DonorAuthContext.Provider value={value}>{children}</DonorAuthContext.Provider>;
}

export function useDonorAuth() {
  const ctx = React.useContext(DonorAuthContext);
  if (!ctx) {
    throw new Error("useDonorAuth must be used within a DonorAuthProvider");
  }
  return ctx;
}
