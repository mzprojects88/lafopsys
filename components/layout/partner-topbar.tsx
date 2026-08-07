"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Share2, Plus, BedDouble, LogOut, Building2, Users, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useHospitalAuth } from "@/context/hospital-auth-provider";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/partners", label: "Dashboard", icon: LayoutDashboard },
  { href: "/partners/patients", label: "Patients", icon: Users },
  { href: "/partners/referrals", label: "Referrals", icon: Share2 },
  { href: "/partners/referrals/new", label: "New Referral", icon: Plus },
  { href: "/partners/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/partners/beds", label: "Bed Availability", icon: BedDouble },
];

export function PartnerTopbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout } = useHospitalAuth();

  const initials = (session?.nurseName ?? "")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function handleLogout() {
    logout();
    router.push("/partners/login");
  }

  return (
    <header className="flex flex-col gap-3 border-b bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-center gap-2">
        <Building2 className="size-5 text-primary" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">{session?.hospitalName}</span>
          <span className="text-xs text-muted-foreground">Partner Hospital Portal</span>
        </div>
      </div>

      <nav className="flex flex-wrap items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Button
              key={item.href}
              asChild
              variant={active ? "secondary" : "ghost"}
              size="sm"
              className={cn("gap-1.5", active && "font-medium")}
            >
              <Link href={item.href}>
                <item.icon className="size-4" />
                {item.label}
              </Link>
            </Button>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        <Avatar className="size-7">
          <AvatarFallback className="bg-cyan-50 text-[11px] font-semibold text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="hidden text-sm font-medium sm:inline">{session?.nurseName}</span>
        <Button variant="ghost" size="icon" onClick={handleLogout} title="Log out">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
