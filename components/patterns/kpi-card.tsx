import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { IconCircle } from "@/components/patterns/icon-circle";
import type { CategoryColor } from "@/lib/utils/category-colors";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  color?: CategoryColor;
  sublabel?: string;
  deltaPct?: number;
  deltaLabel?: string;
  className?: string;
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  color = "blue",
  sublabel,
  deltaPct,
  deltaLabel,
  className,
}: KpiCardProps) {
  const positive = (deltaPct ?? 0) >= 0;

  return (
    <Card className={cn("py-4", className)}>
      {/* Two to a row on a phone: the icon sits above the words so the label is not cut to "Hours T…". */}
      <CardContent className="flex flex-col items-start gap-2 px-4 sm:flex-row sm:items-center sm:gap-3">
        {Icon && <IconCircle icon={Icon} color={color} size="lg" className="size-10 sm:size-12" />}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm leading-tight font-medium text-muted-foreground sm:truncate">{label}</span>
          <span className="text-2xl font-bold tracking-tight tabular-nums">{value}</span>
          {sublabel && <span className="text-xs leading-tight text-muted-foreground sm:truncate">{sublabel}</span>}
          {deltaPct !== undefined && (
            <div
              className={cn(
                "flex items-center gap-1 text-xs font-medium",
                positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              )}
            >
              {positive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              <span>
                {Math.abs(deltaPct)}% {deltaLabel ?? "vs last period"}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function KpiGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4", className)}>
      {children}
    </div>
  );
}
