"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock, House, LayoutGrid, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRole, useVisibleNavItems } from "@/lib/rbac/use-role";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { NAV_GROUPS, navHref, resolveLandingPath, type NavItem } from "@/lib/rbac/roles";

interface Tab {
  title: string;
  href: string;
  /** Pages that count as this tab, for the active state. */
  match: string;
  icon: LucideIcon;
}

/**
 * The phone bottom tabs (below lg), as in LAF Inventory: Home (the person's
 * own start page), Patients, Time, Calendar, and More for every other module
 * the person can open. A tab whose module the role cannot see is left out.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { role, landingPath } = useRole();
  const { rows } = useModuleAccess();
  const items = useVisibleNavItems();
  const [moreOpen, setMoreOpen] = React.useState(false);

  const home = resolveLandingPath({ role, landingPath, next: null }, rows);
  const find = (module: NavItem["module"]) => items.find((i) => i.module === module);
  const patients = find("patients");
  const staff = find("staff");
  const calendar = find("calendar");
  const tabs: Tab[] = [
    { title: "Home", href: home, match: home, icon: House },
    ...(patients ? [{ title: "Patients", href: navHref(patients), match: patients.href, icon: Users }] : []),
    ...(staff ? [{ title: "Time", href: staff.href, match: staff.href, icon: Clock }] : []),
    ...(calendar ? [{ title: "Calendar", href: calendar.href, match: calendar.href, icon: CalendarDays }] : []),
  ].filter((t, i, all) => i === 0 || t.match !== all[0].match); // Home already is that page
  const inTabs = new Set(tabs.map((t) => t.match));
  const more = items.filter((i) => !inTabs.has(i.href));

  const on = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const activeTab = tabs.find((t) => t.match !== home && on(t.match)) ?? (on(home) ? tabs[0] : undefined);
  const moreActive = !activeTab && more.some((i) => on(i.href));

  const tabClass = (active: boolean) =>
    cn("flex flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors", active ? "text-primary" : "text-muted-foreground hover:text-foreground");

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-backdrop-blur:bg-card/80 lg:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-between px-1">
        {tabs.map((tab) => {
          const active = tab === activeTab;
          const Icon = tab.icon;
          return (
            <Link key={tab.title} href={tab.href} className={tabClass(active)} aria-current={active ? "page" : undefined}>
              <Icon className={cn("size-5", active && "fill-accent")} strokeWidth={active ? 2.25 : 1.75} />
              <span>{tab.title}</span>
            </Link>
          );
        })}
        {more.length > 0 ? (
          <button type="button" className={tabClass(moreActive)} onClick={() => setMoreOpen(true)}>
            <LayoutGrid className={cn("size-5", moreActive && "fill-accent")} strokeWidth={moreActive ? 2.25 : 1.75} />
            <span>More</span>
          </button>
        ) : null}
      </div>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[80svh] rounded-t-3xl pb-safe">
          <SheetHeader>
            <SheetTitle>All modules</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-6">
            {NAV_GROUPS.map((group) => {
              const groupItems = more.filter((i) => i.group === group);
              if (groupItems.length === 0) return null;
              return (
                <div key={group}>
                  <h2 className="mb-2 text-xs text-muted-foreground">{group}</h2>
                  <div className="grid grid-cols-3 gap-2">
                    {groupItems.map((item) => {
                      const Icon = item.icon;
                      const active = on(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={navHref(item)}
                          onClick={() => setMoreOpen(false)}
                          className={cn(
                            "flex flex-col items-center gap-2 rounded-2xl border px-2 py-3 text-center text-[11px] leading-tight font-medium transition-colors",
                            active ? "border-primary/40 bg-accent text-accent-foreground" : "border-border bg-card text-foreground hover:bg-muted"
                          )}
                        >
                          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                            <Icon className="size-5" strokeWidth={1.75} />
                          </span>
                          {item.title}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
