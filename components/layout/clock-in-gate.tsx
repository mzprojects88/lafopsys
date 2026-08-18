"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useClockStatus } from "@/lib/hooks/use-clock-status";

/**
 * Staff must clock in for the day before they can reach any screen besides
 * /staff. Roles with no matching `staff` record (the sidebar's demo-only
 * "board"/"volunteer" role switch) have no clock mechanism, so they're
 * exempt rather than being permanently locked out.
 */
export function ClockInGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, hasClockedInToday, loading } = useClockStatus();
  const [mounted, setMounted] = React.useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- avoids gating on the pre-localStorage-sync default identity
  React.useEffect(() => setMounted(true), []);

  const mustClockIn = mounted && !loading && !!me && !hasClockedInToday && pathname !== "/staff";

  React.useEffect(() => {
    if (mustClockIn) {
      toast.info("Please clock in before accessing the rest of the system.");
      router.replace("/staff");
    }
  }, [mustClockIn, router]);

  if (mustClockIn) return null;

  return <>{children}</>;
}
