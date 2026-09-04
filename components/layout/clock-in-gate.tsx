"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useClockStatus } from "@/lib/hooks/use-clock-status";

/**
 * Staff must clock in for the day before they can reach any screen outside
 * /staff (the roster, DTR and clock widget live there). Roles with no
 * matching `staff` record have no clock mechanism, so they're exempt rather
 * than being permanently locked out. Inventory-only roles are exempt too,
 * unless an admin has turned on the "require clock-in" setting (see
 * clockInRequired in use-clock-status.ts).
 *
 * Reads the shared time_entries store, so the moment a punch lands -- from
 * the dialog on /staff, another tab, or another device -- this releases
 * without a reload. `loading` covers the pre-identity window, so there is no
 * default identity to guard against.
 */
export function ClockInGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, hasClockedInToday, clockInRequired, loading } = useClockStatus();

  const mustClockIn = !loading && !!me && clockInRequired && !hasClockedInToday && !pathname.startsWith("/staff");

  React.useEffect(() => {
    if (mustClockIn) {
      toast.info("Please clock in before accessing the rest of the system.");
      router.replace("/staff");
    }
  }, [mustClockIn, router]);

  if (mustClockIn) return null;

  return <>{children}</>;
}
