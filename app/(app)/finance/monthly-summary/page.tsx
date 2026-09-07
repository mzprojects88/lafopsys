import { PageHeader } from "@/components/patterns/page-header";
import { MonthlySummary } from "@/components/modules/finance/monthly-summary";

export default function MonthlySummaryPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Monthly Summary"
        description="Income and expenses as they cleared the bank, month by month, with the story behind each."
      />
      <MonthlySummary />
    </div>
  );
}
