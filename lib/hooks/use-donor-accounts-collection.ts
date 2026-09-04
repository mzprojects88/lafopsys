"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { DonorAccount } from "@/lib/types/donor";

interface DonorAccountRow {
  id: string;
  donor_id: string;
  email: string;
  must_change_password: boolean;
  status: DonorAccount["status"];
}

function toDonorAccount(row: DonorAccountRow): DonorAccount {
  return {
    id: row.id,
    donorId: row.donor_id,
    email: row.email,
    mustChangePassword: row.must_change_password,
    status: row.status,
  };
}

/** shared.donor_accounts -- staff-side read of which donors already have a
 * portal login. Creation happens through the createDonorPortalAccount
 * Server Action (needs the service-role client), not this hook. */
export const donorAccountsStore = createCollection<DonorAccount[]>({
  key: "shared.donor_accounts",
  empty: [],
  tables: [{ schema: "shared", table: "donor_accounts" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("shared").from("donor_accounts").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(toDonorAccount);
  },
});

export function useDonorAccountsData() {
  const { data: accounts, loading } = useCollection(donorAccountsStore);

  return { accounts, loading, refetch: donorAccountsStore.refetch };
}
