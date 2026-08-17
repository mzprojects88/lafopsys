"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Landmark, Wallet } from "lucide-react";
import { useAccountsData } from "@/lib/hooks/use-accounts-collection";
import { formatCurrency } from "@/lib/utils/currency";

export default function AccountsPage() {
  const { accounts } = useAccountsData();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Accounts" description="Bank and cash-on-hand balances by entity." />
      {accounts.length === 0 ? (
        <EmptyState title="No accounts on file" description="Add real bank and cash-on-hand accounts to start tracking balances here." />
      ) : (
        <KpiGrid>
          {accounts.map((a) => (
            <KpiCard
              key={a.id}
              label={`${a.name} (${a.entity === "US_501C3" ? "US" : "PH"})`}
              value={formatCurrency(a.balance, a.currency)}
              icon={a.type === "bank" ? Landmark : Wallet}
              color={a.type === "bank" ? "blue" : "green"}
            />
          ))}
        </KpiGrid>
      )}
    </div>
  );
}
