import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { RealtimeProvider } from "@/lib/data/realtime-provider";

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider schemas={["ops", "shared", "inventory", "hr"]}>
      <AppShell>{children}</AppShell>
    </RealtimeProvider>
  );
}
