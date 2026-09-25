import type { LucideIcon } from "lucide-react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}

/** A dashed card: an icon square, one line that says what fills it, one action. */
export function EmptyState({ title, description, icon: Icon = CheckCircle2, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center", className)}>
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-6" strokeWidth={1.5} />
      </span>
      <span className="text-theme-sm font-medium text-foreground">{title}</span>
      {description && <span className="max-w-[40ch] text-theme-xs text-muted-foreground">{description}</span>}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
