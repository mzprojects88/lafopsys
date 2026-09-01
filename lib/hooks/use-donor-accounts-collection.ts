"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
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
export function useDonorAccountsData() {
  const [accounts, setAccounts] = React.useState<DonorAccount[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("shared").from("donor_accounts").select("*");
    setAccounts((data ?? []).map(toDonorAccount));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  return { accounts, loading, refetch };
}
