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

export function EmptyState({ title, description, icon: Icon = CheckCircle2, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-10 text-center",
        className
      )}
    >
      <Icon className="size-6 text-muted-foreground" />
      <span className="text-sm font-medium">{title}</span>
      {description && <span className="max-w-xs text-xs text-muted-foreground">{description}</span>}
      {action}
    </div>
  );
}
