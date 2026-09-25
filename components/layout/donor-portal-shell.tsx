"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Gift, Sparkles, Megaphone, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useDonorAuth } from "@/context/donor-auth-provider";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/portal/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/donations", label: "Donations", icon: Gift },
  { href: "/portal/impact", label: "Impact", icon: Sparkles },
  { href: "/portal/campaigns", label: "Campaigns", icon: Megaphone },
];

/** Deliberately not AppShell -- that shell (sidebar, ClockInGate, CommandPalette)
 * is staff-role-shaped. A top nav in the staff header's look (DESIGN.md) for
 * the donor-facing surface; on phones the tabs become a swipeable row. */
export function DonorPortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { donorName, signOut } = useDonorAuth();

  const tabs = (
    <nav className="no-scrollbar flex items-center gap-1 overflow-x-auto">
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-theme-sm font-medium transition-colors",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="size-4.5" strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-svh flex-col">
      <header className="pt-safe sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-(--breakpoint-xl) items-center gap-4 px-4 lg:px-6">
          <Link href="/portal/dashboard" className="flex shrink-0 items-center gap-3" aria-label="Donor portal home">
            <Image src="/logo/laf-horizontal.png" alt="Little Ark Foundation" width={150} height={28} priority className="hidden h-7 w-auto sm:block" />
            <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={32} height={34} priority className="h-8 w-auto sm:hidden" />
          </Link>
          <div className="hidden flex-1 md:block">{tabs}</div>
          <div className="ml-auto flex items-center gap-3">
            {donorName && <span className="hidden text-theme-sm text-muted-foreground lg:inline">{donorName}</span>}
            <ThemeToggle />
            <Button variant="outline" className="gap-1.5" onClick={() => signOut()}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>
        <div className="border-t border-border px-4 py-2 md:hidden">{tabs}</div>
      </header>
      <main className="mx-auto flex w-full max-w-(--breakpoint-xl) flex-1 flex-col gap-4 px-4 pt-4 pb-10 lg:gap-6 lg:px-6 lg:pt-6">{children}</main>
    </div>
  );
}
