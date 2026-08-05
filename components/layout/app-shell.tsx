"use client";

import * as React from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/sidebar-nav";
import { Topbar } from "@/components/layout/topbar";
import { AppFooter } from "@/components/layout/app-footer";
import { ClockInGate } from "@/components/layout/clock-in-gate";
import { CommandPalette } from "@/components/layout/command-palette";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Topbar onSearchClick={() => setPaletteOpen(true)} />
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <ClockInGate>{children}</ClockInGate>
        </main>
        <AppFooter />
      </SidebarInset>
      <CommandPalette externalOpen={paletteOpen} onExternalOpenChange={setPaletteOpen} />
    </SidebarProvider>
  );
}
