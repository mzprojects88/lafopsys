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
    <>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent/40"
        >
          <IconCircle icon={item.icon} color={item.color} size="sm" />
          {item.label}
        </Link>
      ))}
    </>
  );
}
