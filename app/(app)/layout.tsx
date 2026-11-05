import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { RealtimeProvider } from "@/lib/data/realtime-provider";
import { AiConsentGate } from "@/components/layout/ai-consent-gate";
import { ErrorReporter } from "@/components/layout/error-reporter";

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider schemas={["ops", "shared", "inventory", "hr"]}>
      <AppShell>{children}</AppShell>
      <ErrorReporter />
      <AiConsentGate />
    </RealtimeProvider>
  );
}
