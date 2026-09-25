import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** TailAdmin's page title: the trail back up (deeper pages only), then the
 * title and what the page is for, with its actions on the right. */
export function PageHeader({ title, description, action, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Breadcrumbs />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground lg:text-2xl">{title}</h1>
          {description && <p className="max-w-[72ch] text-theme-sm text-muted-foreground">{description}</p>}
        </div>
        {/* Full width below `sm` so a wrapped action row (most often ModuleSubNav) can
            scroll horizontally within the viewport; from `sm` it may shrink and wrap, so
            nine sub-menu buttons (Patients) wrap onto a second row instead of running off. */}
        {action && <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 sm:w-auto">{action}</div>}
      </div>
    </div>
  );
}
