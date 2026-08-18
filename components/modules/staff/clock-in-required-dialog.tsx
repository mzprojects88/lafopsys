"use client";

import * as React from "react";
import { LogIn, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IconCircle } from "@/components/patterns/icon-circle";
import { useClockStatus } from "@/lib/hooks/use-clock-status";

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Blocks interaction with the rest of the app until the logged-in staff
 * member clocks in for the day. Intentionally non-dismissable — clocking in
 * is the only way to close it, mirroring the ClockInGate navigation rule.
 */
export function ClockInRequiredDialog() {
  const { me, hasClockedInToday, loading, clockIn } = useClockStatus();
  const [mounted, setMounted] = React.useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- avoids flashing open on the pre-localStorage-sync default identity
  React.useEffect(() => setMounted(true), []);

  const open = mounted && !loading && !!me && !hasClockedInToday;

  async function handleClockIn() {
    const result = await clockIn();
    if (result?.ok === false) toast.error(result.error);
    else toast.success(`Clocked in at ${nowLabel()}`);
  }

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="items-center text-center">
          <IconCircle icon={ShieldAlert} color="amber" size="lg" />
          <DialogTitle className="text-base">Clock In Required</DialogTitle>
          <DialogDescription>
            You must clock in before you can access the rest of the LAF Operating System. Clock in
            below to continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="lg" className="w-full gap-2" onClick={handleClockIn}>
            <LogIn className="size-4" />
            Clock In Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
