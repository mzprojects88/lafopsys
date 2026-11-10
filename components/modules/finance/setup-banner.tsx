"use client";

import Link from "next/link";
import { Settings2 } from "lucide-react";
import { useCollection } from "@/lib/data/collection-store";
import { setupChecklistStore } from "@/lib/hooks/use-finance-setup";

/** For whoever sets up Finance: how many setup items stand between LAF and its first payment request (0133). */
export function FinanceSetupBanner() {
  const { data } = useCollection(setupChecklistStore);
  const open = data?.items.filter((i) => !i.done).length ?? 0;
  if (!data || data.ready) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3">
      <Settings2 className="size-5 text-warning" />
      <p className="min-w-0 flex-1 text-theme-sm">
        {open} setup {open === 1 ? "item" : "items"} to resolve before payment requests open.
      </p>
      <Link href="/finance/settings" className="text-theme-sm font-medium text-primary hover:underline">Financial Settings →</Link>
    </div>
  );
}
