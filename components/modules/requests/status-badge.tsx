import { STATUS_TONE_CLASSES, type StatusTone } from "@/lib/utils/status-colors";
import { STATUS_LABEL, type VoucherStatus } from "@/lib/utils/vouchers";
import { cn } from "@/lib/utils";

const TONE: Record<VoucherStatus, StatusTone> = {
  draft: "neutral",
  submitted: "info",
  endorsed: "info",
  prepared: "info",
  reviewed: "info",
  approved: "info",
  payment_prepared: "info",
  payment_approved: "info",
  released: "positive",
  returned: "warning",
  rejected: "negative",
  cancelled: "neutral",
};

/** A payment request's status in words, coloured by whether it is moving, done or stopped. */
export function VoucherStatusBadge({ status, className }: { status: VoucherStatus; className?: string }) {
  return (
    <span className={cn("inline-flex w-fit shrink-0 items-center rounded-full px-2.5 py-0.5 text-theme-xs font-medium whitespace-nowrap", STATUS_TONE_CLASSES[TONE[status]], className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}
