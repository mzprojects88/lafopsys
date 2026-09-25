"use client";

import Link from "next/link";
import { KeyRound, LogOut, PanelLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/context/sidebar-provider";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NotificationCenter } from "@/components/layout/notification-center";
import { ClockStatusBadge } from "@/components/layout/clock-status-badge";
import { useAccount } from "@/components/layout/account";

/**
 * The desktop top bar (lg and up), as in LAF Inventory: sidebar toggle,
 * search, then the clock, theme, notifications and the account menu. The
 * page's own title and breadcrumbs are in its PageHeader. Phones get Topbar.
 */
export function Header({ onSearchClick }: { onSearchClick: () => void }) {
  const { toggle } = useSidebar();
  const { user, roleLabel, initials, signOut } = useAccount();

  return (
    <header className="sticky top-0 z-30 hidden h-16 shrink-0 items-center gap-3 border-b border-border bg-card/95 px-6 backdrop-blur lg:flex">
      <Button variant="outline" size="icon-lg" aria-label="Toggle sidebar" onClick={toggle}>
        <PanelLeft className="size-4.5" />
      </Button>

      <button
        type="button"
        onClick={onSearchClick}
        className="flex h-11 w-full max-w-md items-center gap-2.5 rounded-lg border border-input bg-card px-4 text-theme-sm text-muted-foreground shadow-theme-xs transition-colors hover:bg-muted"
      >
        <Search className="size-4.5 shrink-0" />
        <span className="flex-1 text-left">Search patients, donors, pages…</span>
        <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-theme-xs">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-3">
        <ClockStatusBadge />
        <ThemeToggle />
        <NotificationCenter />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-muted" aria-label="Account menu">
              <Avatar className="size-9">
                <AvatarFallback className="bg-accent text-xs font-medium text-accent-foreground">{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden flex-col leading-tight xl:flex">
                <span className="text-theme-sm font-medium text-foreground">{user}</span>
                <span className="text-theme-xs text-muted-foreground">{roleLabel}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col">
              <span className="font-medium">{user}</span>
              <span className="text-xs font-normal text-muted-foreground">{roleLabel}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/change-pin">
                <KeyRound className="size-4" />
                Change PIN
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={signOut}>
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
