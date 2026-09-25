import { PersonAvatar } from "@/components/patterns/person-avatar";
import { cn } from "@/lib/utils";

interface EntityDetailHeaderProps {
  title: string;
  subtitle?: string;
  initials?: string;
  badge?: React.ReactNode;
  metadata?: { label: string; value: React.ReactNode }[];
  actions?: React.ReactNode;
  className?: string;
}

export function EntityDetailHeader({
  title,
  subtitle,
  initials,
  badge,
  metadata,
  actions,
  className,
}: EntityDetailHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 rounded-2xl border border-border bg-card p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {initials && <PersonAvatar name={title} size="lg" />}
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h1 className="text-xl leading-tight font-semibold text-foreground">{title}</h1>
              {badge}
            </div>
            {subtitle && <span className="text-theme-sm text-muted-foreground">{subtitle}</span>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {metadata && metadata.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-4">
          {metadata.map((m) => (
            <div key={m.label} className="flex flex-col gap-0.5">
              <span className="text-theme-xs text-muted-foreground">{m.label}</span>
              <span className="text-theme-sm font-medium text-foreground">{m.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
