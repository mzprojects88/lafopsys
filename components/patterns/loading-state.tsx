import { Skeleton } from "@/components/ui/skeleton";

/** What a list shows while its data is still arriving -- instead of "Loading…"
 * text, or the "₱0" / "Nothing yet" that still-empty arrays would render. */
export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
