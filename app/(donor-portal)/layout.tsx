"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AuthBackdrop } from "@/components/layout/auth-backdrop";
import { DonorPortalShell } from "@/components/layout/donor-portal-shell";
import { DonorAuthProvider } from "@/context/donor-auth-provider";
import { RealtimeProvider } from "@/lib/data/realtime-provider";

const BARE_PATHS = ["/portal/login", "/portal/change-password"];

/** Mirrors the (auth)/(app) split for staff: login and the forced
 * password-change screen render bare (no nav, no donor identity needed yet
 * -- both pages check their own session directly, same as
 * app/(auth)/change-pin/page.tsx does for staff); every other /portal/*
 * route gets the real donor nav shell, backed by DonorAuthProvider. */
export default function DonorPortalLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (BARE_PATHS.includes(pathname)) {
    return <AuthBackdrop>{children}</AuthBackdrop>;
  }

  return (
    <DonorAuthProvider>
      <RealtimeProvider schemas={["ops"]}>
        <DonorPortalShell>{children}</DonorPortalShell>
      </RealtimeProvider>
    </DonorAuthProvider>
  );
}
