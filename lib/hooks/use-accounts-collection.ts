"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { Account } from "@/lib/types/finance";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface AccountRow {
  id: string;
  name: string;
  entity: Account["entity"];
  currency: Account["currency"];
  balance: number | null;
  type: Account["type"];
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    entity: row.entity,
    currency: row.currency,
    balance: row.balance ?? 0,
    type: row.type,
  };
}

/** ops.accounts starts empty -- the 3 demo balances in mock-data were entirely
 * fabricated, not real LAF account data. Staff add real accounts here. */
export function useAccountsData() {
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("accounts").select("*").order("name");
    setAccounts((data ?? []).map(toAccount));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function addAccount(account: Omit<Account, "id">): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("accounts").insert({
      id: crypto.randomUUID(),
      name: account.name,
      entity: account.entity,
      currency: account.currency,
      balance: account.balance,
      type: account.type,
    });
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { accounts, loading, addAccount, refetch };
}
