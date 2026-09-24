"use client";

import * as React from "react";
import { LogIn, ShieldAlert } from "lucide-react";
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
import { PunchCameraDialog } from "@/components/modules/staff/punch-camera-dialog";
import { useClockStatus } from "@/lib/hooks/use-clock-status";

/**
 * Blocks interaction with the rest of the app until the logged-in staff
 * member clocks in for the day. Intentionally non-dismissable — clocking in
 * is the only way to close it, mirroring the ClockInGate navigation rule.
 */
export function ClockInRequiredDialog() {
  const { me, hasClockedInToday, clockInRequired, loading } = useClockStatus();

  // Same rule as ClockInGate: inventory roles are only held here when the
  // admin setting requires it. `loading` already covers the pre-identity window.
  const open = !loading && !!me && clockInRequired && !hasClockedInToday;
  // The punch itself happens in the camera dialog (photo + location, 0060).
  const [camera, setCamera] = React.useState(false);

  return (
    <>
    <Dialog open={open && !camera}>
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
        <p className="text-center text-xs text-muted-foreground">
          Clocking in takes a photo and records your location, device and network address to your Daily
          Time Record. Only admins and HR can see the photo.
        </p>
        <DialogFooter>
          <Button size="lg" className="w-full gap-2" onClick={() => setCamera(true)}>
            <LogIn className="size-4" />
            Clock In Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {open && camera ? <PunchCameraDialog punchType="clock_in" open dismissable onOpenChange={(o) => !o && setCamera(false)} /> : null}
    </>
  );
}
