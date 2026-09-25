import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CategoryColor } from "@/lib/utils/category-colors";
import type { StatTone } from "@/components/patterns/kpi-card";

interface IconCircleProps {
  icon: LucideIcon;
  /** @deprecated Modules no longer have colours (DESIGN.md); use `tone`. */
  color?: CategoryColor;
  /** "default" is the blue accent wash; the others mean something (see KpiCard). */
  tone?: StatTone;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = { sm: "size-8 rounded-lg", md: "size-10 rounded-xl", lg: "size-12 rounded-xl" };
const ICON_SIZE_CLASSES = { sm: "size-4", md: "size-5", lg: "size-6" };
const TONE_CLASSES: Record<StatTone, string> = {
  default: "bg-accent text-accent-foreground",
  warning: "bg-warning/12 text-warning-foreground dark:bg-warning/15 dark:text-warning",
  negative: "bg-destructive/10 text-destructive",
  positive: "bg-success/12 text-success-foreground dark:bg-success/15 dark:text-success",
};

/** An icon in a tinted square (the name stayed from when it was round). */
export function IconCircle({ icon: Icon, tone = "default", size = "md", className }: IconCircleProps) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", SIZE_CLASSES[size], TONE_CLASSES[tone], className)}>
      <Icon className={ICON_SIZE_CLASSES[size]} strokeWidth={1.75} />
    </span>
  );
}
