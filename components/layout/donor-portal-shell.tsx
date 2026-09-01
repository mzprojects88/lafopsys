"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Gift, Sparkles, Megaphone, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDonorAuth } from "@/context/donor-auth-provider";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/portal/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/donations", label: "Donations", icon: Gift },
  { href: "/portal/impact", label: "Impact", icon: Sparkles },
  { href: "/portal/campaigns", label: "Campaigns", icon: Megaphone },
];

/** Deliberately not AppShell -- that shell (sidebar, ClockInGate, CommandPalette)
 * is staff-role-shaped. This is a plain top nav for the donor-facing surface. */
export function DonorPortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { donorName, signOut } = useDonorAuth();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={32} height={34} />
          <span className="text-sm font-semibold text-foreground">Donors Portal</span>
        </div>
        <nav className="flex flex-wrap items-center gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          {donorName && <span className="text-sm text-muted-foreground">{donorName}</span>}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => signOut()}>
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
    </div>
  );
}
