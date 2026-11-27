"use client";

import * as React from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { directCardToken } from "@/lib/direct/direct";
import { useBarcodeScanner } from "@/lib/hooks/use-barcode-scanner";

/**
 * The camera for "Direct donations" (Inventory 0082): reads a Patient ID card and hands back its code. Rendered only
 * while scanning (mount = camera on, unmount = off). A code that is not a card says so and keeps scanning.
 */
export function DirectScanner({ onToken, onClose }: { onToken: (token: string) => void; onClose: () => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [restart, setRestart] = React.useState(0);
  const { cameraState, cameraError } = useBarcodeScanner(
    videoRef,
    (text) => {
      const token = directCardToken(text);
      if (token) return onToken(token);
      toast.error("That code is not a Patient ID card. Try again.");
      setTimeout(() => setRestart((n) => n + 1), 1200);
    },
    restart
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* The <video> appears a moment after mount: start the camera once it is there. */}
      <DialogContent onOpenAutoFocus={() => setRestart((n) => n + 1)}>
        <DialogHeader>
          <DialogTitle>Scan the Patient ID card</DialogTitle>
          <DialogDescription>Hold the card&apos;s code in front of the camera.</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border bg-black">
          <video ref={videoRef} className="size-full object-cover" muted playsInline />
          {cameraState !== "active" ? (
            <p className="absolute inset-0 flex items-center justify-center bg-card px-6 text-center text-theme-sm text-muted-foreground">
              {cameraState === "starting" ? "Starting the camera…" : `The camera is not available${cameraError ? ` (${cameraError})` : ""}. Allow camera access for this site.`}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
