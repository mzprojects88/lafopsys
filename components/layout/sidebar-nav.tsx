"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/context/sidebar-provider";
import { useSheetChanges } from "@/lib/hooks/use-sheet-changes";
import { useVisibleNavItems } from "@/lib/rbac/use-role";
import { NAV_GROUPS, navHref } from "@/lib/rbac/roles";

/**
 * The desktop navigation (lg and up), in TailAdmin's sidebar language, the
 * same as LAF Inventory's: a 290 px panel that collapses to a 90 px rail and
 * expands back while hovered. Items and their order come from NAV_ITEMS
 * (lib/rbac/roles.ts), grouped under Main / Work / Manage; hidden modules and
 * modules the role cannot open never reach this list.
 */
export function AppSidebar() {
  const { expanded, hovered, setHovered } = useSidebar();
  const pathname = usePathname();
  const items = useVisibleNavItems();
  // Changes on the original Patients Database waiting for someone (0064); RLS shows them only to Patients viewers.
  const sheetChanges = useSheetChanges().pending.length;
  const open = expanded || hovered;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar px-5 text-sidebar-foreground transition-[width] duration-200 ease-out lg:flex",
        open ? "w-[290px]" : "w-[90px]"
      )}
      onMouseEnter={() => !expanded && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={cn("flex h-20 shrink-0 items-center", open ? "justify-start" : "justify-center")}>
        <Link href="/dashboard" className="flex items-center" aria-label="LAF Operating System home">
          {open ? (
            <Image src="/logo/laf-horizontal.png" alt="Little Ark Foundation" width={150} height={28} priority className="h-7 w-auto" />
          ) : (
            <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={32} height={34} priority className="h-8 w-auto" />
          )}
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto pb-6 no-scrollbar">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group}>
              <h2 className={cn("mb-3 flex text-xs leading-5 text-muted-foreground", open ? "justify-start" : "justify-center")}>
                {open ? group : <Ellipsis className="size-5" aria-label={group} />}
              </h2>
              <ul className="flex flex-col gap-1">
                {groupItems.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const badge = item.module === "patients" && sheetChanges > 0 ? sheetChanges : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={navHref(item)}
                        aria-current={active ? "page" : undefined}
                        title={open ? undefined : item.title}
                        className={cn(
                          "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-theme-sm font-medium transition-colors",
                          active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-muted",
                          !open && "justify-center"
                        )}
                      >
                        <Icon className={cn("size-5 shrink-0", active ? "text-sidebar-accent-foreground" : "text-muted-foreground group-hover:text-foreground")} strokeWidth={1.75} />
                        {open ? <span className="flex-1 truncate">{item.title}</span> : null}
                        {badge ? (
                          <span
                            title={`${badge} change${badge === 1 ? "" : "s"} on the original sheet to review`}
                            className={cn(
                              "flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground",
                              !open && "absolute top-0.5 right-1.5"
                            )}
                          >
                            {badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
