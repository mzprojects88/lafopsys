"use client";

import * as React from "react";
import { toast } from "sonner";
import { Camera, CameraOff, LogIn, LogOut } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { captureLocation, useClockStatus, type CapturedLocation } from "@/lib/hooks/use-clock-status";
import { PHOTO_MAX_SIDE, PHOTO_QUALITY } from "@/lib/utils/punch-photo";

type CameraState = "starting" | "live" | "denied" | "unavailable";

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Clock in or out with a live photo from the front camera and the location
 * (0060). The picture must come from the camera, never the gallery. If the
 * camera is refused or missing the person can still punch -- the clock-in
 * gate would otherwise lock them out of the app -- and the punch is marked
 * "no photo" for admins and HR.
 */
export function PunchCameraDialog({
  punchType,
  open,
  onOpenChange,
  dismissable = true,
}: {
  punchType: "clock_in" | "clock_out";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The clock-in-required dialog opens this and must not be closable. */
  dismissable?: boolean;
}) {
  const { clockIn, clockOut } = useClockStatus();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const locationRef = React.useRef<Promise<CapturedLocation> | null>(null);
  const [camera, setCamera] = React.useState<CameraState>("starting");
  const [punching, setPunching] = React.useState(false);
  const isIn = punchType === "clock_in";

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Both at once: the location fix and the camera take a few seconds each.
    locationRef.current = captureLocation();
    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => setCamera("unavailable"));
    } else {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 } }, audio: false })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) videoRef.current.srcObject = stream;
          setCamera("live");
        })
        .catch((e: { name?: string }) => {
          if (!cancelled) setCamera(e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "denied" : "unavailable");
        });
    }
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCamera("starting");
    };
  }, [open]);

  function snapshot(): string | null {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
  }

  async function submit(withPhoto: boolean) {
    const photo = withPhoto ? snapshot() : null;
    if (withPhoto && !photo) {
      toast.error("The camera is not ready yet.");
      return;
    }
    setPunching(true);
    const capture = {
      location: locationRef.current ?? undefined,
      ...(photo ? { photo } : { photoStatus: camera === "denied" ? ("denied" as const) : ("unavailable" as const) }),
    };
    const result = isIn ? await clockIn(capture) : await clockOut(capture);
    setPunching(false);
    if (!result || result.ok === false) {
      toast.error(result && result.ok === false ? result.error : "Couldn't record the punch.");
      return;
    }
    toast.success(`${isIn ? "Clocked in" : "Clocked out"} at ${nowLabel()}`);
    onOpenChange(false);
  }

  const Icon = isIn ? LogIn : LogOut;
  const label = isIn ? "Clock in" : "Clock out";

  return (
    <Dialog open={open} onOpenChange={(o) => (dismissable || o) && !punching && onOpenChange(o)}>
      <DialogContent
        showCloseButton={dismissable}
        className="sm:max-w-sm"
        onEscapeKeyDown={(e) => !dismissable && e.preventDefault()}
        onInteractOutside={(e) => !dismissable && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            A photo and your location are added to your Daily Time Record. You can see your entries and locations; only admins and HR can see the
            photo.
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-muted">
          {/* Mirrored like a mirror; the saved photo is not. */}
          <video ref={videoRef} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />
          {camera !== "live" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
              {camera === "starting" ? (
                <>
                  <Camera className="size-6" />
                  Starting the camera…
                </>
              ) : (
                <>
                  <CameraOff className="size-6" />
                  {camera === "denied"
                    ? "The camera is blocked. Allow it in your browser's site settings, then open this again."
                    : "No camera could be started on this device."}
                </>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button size="lg" className="h-12 w-full gap-2 text-base" disabled={camera !== "live" || punching} onClick={() => submit(true)}>
            <Icon className="size-5" />
            {punching ? "Recording…" : `Take photo & ${label.toLowerCase()}`}
          </Button>
          {camera === "denied" || camera === "unavailable" ? (
            <Button variant="outline" className="w-full" disabled={punching} onClick={() => submit(false)}>
              {label} without a photo (marked for admin and HR)
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
