"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, LogOut, Moon, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { NAV_ITEMS, moduleForPath } from "@/lib/rbac/roles";
import { ClockStatusBadge } from "@/components/layout/clock-status-badge";
import { useAccount } from "@/components/layout/account";

/**
 * The phone top bar (below lg), as in LAF Inventory: where you are, search,
 * the clock (clock-out has to be one tap away on a phone) and an account
 * sheet. The modules are in the bottom tabs.
 */
export function Topbar({ onSearchClick }: { onSearchClick: () => void }) {
  const pathname = usePathname();
  const current = moduleForPath(pathname);
  const title = NAV_ITEMS.find((i) => i.module === current)?.title ?? "LAF Operating System";
  const { user, roleLabel, initials, signOut } = useAccount();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = React.useState(false);

  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-backdrop-blur:bg-card/80 lg:hidden">
      <div className="flex h-14 items-center gap-1.5 px-4">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</h1>
        <Button variant="ghost" size="icon" className="size-9" aria-label="Search" onClick={onSearchClick}>
          <Search className="size-5" />
        </Button>
        <ClockStatusBadge />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9" aria-label="Account menu">
              <Avatar className="size-7">
                <AvatarFallback className="bg-accent text-[11px] text-accent-foreground">{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[85vw] max-w-sm">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-accent text-accent-foreground">{initials}</AvatarFallback>
                </Avatar>
                <span className="flex flex-col text-left">
                  <span className="text-sm font-semibold">{user}</span>
                  <span className="text-xs font-normal text-muted-foreground">{roleLabel}</span>
                </span>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 px-4">
              <Link
                href="/change-pin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <KeyRound className="size-4.5 text-muted-foreground" />
                Change PIN
              </Link>
              <label className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm font-medium text-foreground">
                <span className="flex items-center gap-3">
                  <Moon className="size-4.5 text-muted-foreground" />
                  Dark mode
                </span>
                <Switch checked={resolvedTheme === "dark"} onCheckedChange={(on) => setTheme(on ? "dark" : "light")} aria-label="Dark mode" />
              </label>
            </nav>
            <SheetFooter>
              <Button variant="outline" className="w-full gap-2" onClick={signOut}>
                <LogOut className="size-4" />
                Sign out
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
