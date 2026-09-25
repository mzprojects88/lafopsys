import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * TailAdmin's ComponentCard: a titled card with a hairline between the
 * header and the body. Dashboard widgets and detail-page sections.
 */
export function SectionCard({ title, description, actions, children, className, bodyClassName, flush }: { title?: ReactNode; description?: string; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; /** No body padding: for tables and lists that draw their own rows. */ flush?: boolean }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card", className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
          <div className="flex min-w-0 flex-col">
            {title ? <h3 className="text-base font-medium text-foreground">{title}</h3> : null}
            {description ? <p className="text-theme-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(title || actions ? "border-t border-border" : "", flush ? "" : "p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
