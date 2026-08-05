import { cn } from "@/lib/utils";
import { getStatusTone, STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

interface StatusBadgeProps {
  domain: string;
  status: string;
  label?: string;
  dot?: boolean;
  className?: string;
}

function toLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function StatusBadge({ domain, status, label, dot = false, className }: StatusBadgeProps) {
  const tone = getStatusTone(domain, status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        STATUS_TONE_CLASSES[tone],
        className
      )}
    >
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-current" />}
      {label ?? toLabel(status)}
    </span>
  );
}
