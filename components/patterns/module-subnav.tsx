import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { IconCircle } from "@/components/patterns/icon-circle";
import type { CategoryColor } from "@/lib/utils/category-colors";

export interface ModuleSubNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  color: CategoryColor;
}

export function ModuleSubNav({ items }: { items: ModuleSubNavItem[] }) {
  return (
    // On a phone these pills used to wrap into a tall stack that pushed the page's
    // real content below the fold -- five sub-nav items on /patients cost most of the
    // first screen. Below `sm` they become a single swipeable row instead. `sm:contents`
    // dissolves this wrapper on larger screens so the links stay direct children of
    // PageHeader's action flex row and desktop layout is unchanged.
    <div className="no-scrollbar flex w-full gap-2 overflow-x-auto sm:contents">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex shrink-0 items-center gap-2.5 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent/40"
        >
          <IconCircle icon={item.icon} color={item.color} size="sm" />
          {item.label}
        </Link>
      ))}
    </div>
  );
}
