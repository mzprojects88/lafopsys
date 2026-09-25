import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { isHiddenPath } from "@/lib/rbac/hidden";

export interface ModuleSubNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export function ModuleSubNav({ items }: { items: ModuleSubNavItem[] }) {
  return (
    // On a phone these pills used to wrap into a tall stack that pushed the page's
    // real content below the fold -- five sub-nav items on /patients cost most of the
    // first screen. Below `sm` they become a single swipeable row instead. `sm:contents`
    // dissolves this wrapper on larger screens so the links stay direct children of
    // PageHeader's action flex row and desktop layout is unchanged.
    <div className="no-scrollbar flex w-full gap-2 overflow-x-auto sm:contents">
      {items.filter((item) => !isHiddenPath(item.href)).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-input bg-card px-3.5 text-theme-sm font-medium text-foreground shadow-theme-xs transition-colors hover:bg-muted"
        >
          <item.icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
          {item.label}
        </Link>
      ))}
    </div>
  );
}
