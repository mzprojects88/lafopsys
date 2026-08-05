import { PageHeader } from "@/components/patterns/page-header";
import { EntryForm } from "@/components/modules/finance/entry-form";

export default function FinanceEntryPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="New Cash Entry" description="Multi-entity, multi-currency inflow or outflow." />
      <EntryForm />
    </div>
  );
}
