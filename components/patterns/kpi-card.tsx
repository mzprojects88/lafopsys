import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { CategoryColor } from "@/lib/utils/category-colors";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "warning" | "negative" | "positive";

const ICON_TONE: Record<StatTone, string> = {
  default: "bg-muted text-foreground",
  warning: "bg-warning/12 text-warning-foreground dark:bg-warning/15 dark:text-warning",
  negative: "bg-destructive/10 text-destructive",
  positive: "bg-success/12 text-success-foreground dark:bg-success/15 dark:text-success",
};

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  /** Tints the icon when the figure is a signal: warning (needs attention),
   * negative (a problem), positive (good news). Most figures are "default". */
  tone?: StatTone;
  /** @deprecated Modules no longer have colours (DESIGN.md); use `tone`. */
  color?: CategoryColor;
  sublabel?: string;
  deltaPct?: number;
  deltaLabel?: string;
  className?: string;
}

/**
 * LAF Inventory's StatCard (TailAdmin's metric tile): an icon square, then the
 * label and a bold tabular value. A half-width phone column is too narrow to
 * seat "₱91,430.00" beside an icon, so the figure gets the whole width.
 */
export function KpiCard({ label, value, icon: Icon, tone = "default", sublabel, deltaPct, deltaLabel, className }: KpiCardProps) {
  const up = (deltaPct ?? 0) >= 0;

  return (
    <div className={cn("flex flex-col rounded-2xl border border-border bg-card p-4 lg:p-5", className)}>
      {Icon ? (
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl lg:size-12", ICON_TONE[tone])}>
          <Icon className="size-5 lg:size-6" strokeWidth={1.75} />
        </span>
      ) : null}
      <div className={cn("flex min-w-0 flex-col", Icon && "mt-3 lg:mt-5")}>
        <span className="text-theme-xs leading-snug text-muted-foreground lg:text-theme-sm">{label}</span>
        <span className="mt-1 text-lg leading-tight font-bold tabular-nums break-words text-foreground lg:mt-2 lg:text-title-sm">{value}</span>
        {sublabel ? <span className="mt-1 text-theme-xs leading-snug text-muted-foreground">{sublabel}</span> : null}
        {deltaPct !== undefined ? (
          <span
            className={cn(
              "mt-2 flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-theme-xs font-medium",
              up ? "bg-success/12 text-success-foreground dark:bg-success/15 dark:text-success" : "bg-destructive/10 text-destructive dark:bg-destructive/15"
            )}
          >
            {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(deltaPct)}% {deltaLabel ?? "vs last period"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function KpiGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-6", className)}>{children}</div>;
}
