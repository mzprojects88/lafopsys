import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { campaigns } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/utils/currency";

export default function CampaignsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Campaigns" description="Donations grouped by appeal, tracked against target." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {campaigns.map((c) => {
          const pct = Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100));
          return (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="text-base">{c.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-semibold">{formatCurrency(c.raisedAmount)}</span>
                  <span className="text-sm text-muted-foreground">of {formatCurrency(c.targetAmount)}</span>
                </div>
                <Progress value={pct} />
                <span className="text-xs text-muted-foreground">{pct}% of target</span>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
