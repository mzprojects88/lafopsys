"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Camera, Loader2 } from "lucide-react";
import { ROUTE_MIN_TRIPS, formatKm, isUnusualTrip, odometerDigits, parseOdometer, readingProblem } from "@/lib/utils/odometer";
import { shrinkImage } from "@/lib/utils/shrink-image";
import { sendOdometerPhoto, type OdometerPhotoRead } from "@/lib/hooks/use-vehicles-collection";

/** One drum: a column of 0-9 that rolls to its digit, shaded like a cylinder. */
function Drum({ digit }: { digit: number }) {
  return (
    <span className="relative h-11 w-8 overflow-hidden rounded-md bg-instrument shadow-[inset_0_2px_3px_rgb(0_0_0/0.7),inset_0_-2px_3px_rgb(0_0_0/0.7)] ring-1 ring-white/10 sm:h-14 sm:w-10">
      <span
        className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `translateY(-${digit * 10}%)` }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n} className="flex h-11 items-center justify-center text-2xl font-semibold tabular-nums text-instrument-foreground sm:h-14 sm:text-3xl">
            {n}
          </span>
        ))}
      </span>
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/55" />
    </span>
  );
}

/**
 * The odometer as rolling number drums (Fuel Monitoring, 0076). With onChange it is an input:
 * a real numeric field lies over the drums, so a tap opens the phone's number pad and the
 * drums roll as the driver types.
 */
export function OdometerDrums({
  value,
  onChange,
  label = "Odometer reading",
  className,
}: {
  value: number | null;
  onChange?: (km: number | null) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative inline-flex items-center gap-2 rounded-xl bg-instrument p-2 shadow-theme-md ring-1 ring-black/10",
        onChange && "cursor-text has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-primary",
        className
      )}
      role={onChange ? undefined : "img"}
      aria-label={onChange ? undefined : value == null ? "No odometer reading yet" : formatKm(value)}
    >
      <span className="flex gap-1" aria-hidden>
        {odometerDigits(value).map((d, i) => (
          <Drum key={i} digit={Number(d)} />
        ))}
      </span>
      <span className="pr-1 text-theme-xs font-medium text-instrument-muted" aria-hidden>
        km
      </span>
      {onChange && (
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label={label}
          value={value == null ? "" : String(value)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(parseOdometer(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
        />
      )}
    </div>
  );
}

// No usual km for this route yet (under three trips): a fixed "that's a long trip" prompt instead.
const LONG_TRIP_KM = 300;

/**
 * "Photo of the odometer": the phone's camera, the picture shrunk and sent to be filed and
 * read by the AI (0078). The reading comes back to fill the drums; the driver still confirms.
 */
export function OdometerPhotoButton({
  vehicleId,
  stage,
  onRead,
  label = "Photo of the odometer",
}: {
  vehicleId: string;
  stage: "depart" | "arrive" | "pump" | "other";
  onRead: (read: OdometerPhotoRead) => void;
  label?: string;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function send(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await sendOdometerPhoto(vehicleId, stage, await shrinkImage(file, 1280));
      if (!r.ok) toast.error(r.error);
      else onRead(r.read);
    } catch {
      toast.error("That photo couldn't be opened; take it again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => send(e.target.files?.[0])} />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Camera />} {busy ? "Reading the photo…" : label}
      </Button>
    </>
  );
}

/** What the AI made of the photo, in a line under the drums. */
export function PhotoReadNote({ read }: { read: OdometerPhotoRead | null }) {
  if (!read) return null;
  return read.reading != null ? (
    <p className="text-center text-theme-xs text-success-foreground dark:text-success">
      AI read {formatKm(read.reading)}. Check it matches the dashboard.
    </p>
  ) : (
    <p className="text-center text-theme-xs text-warning-foreground">Photo saved; the AI couldn&apos;t read it ({read.note}). Roll the drums to the reading.</p>
  );
}

/** Depart / arrive with the odometer: the drums prefilled, Confirm when they match the dashboard. */
export function OdometerDialog({
  title,
  description,
  vehicleId,
  stage,
  photoRequired = false,
  initial,
  lowest,
  tripStart,
  usual,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  vehicleId: string;
  stage: "depart" | "arrive";
  /** The day's first departure needs a photo (0078). */
  photoRequired?: boolean;
  initial: number | null;
  /** The reading may not be below this (the vehicle's last, or this trip's departure). */
  lowest: number | null;
  /** On arrival: the departure reading, to show this trip's km. */
  tripStart?: number | null;
  /** On arrival: the route's usual km, learned from past trips. */
  usual?: { medianKm: number; trips: number } | null;
  confirmLabel: string;
  onConfirm: (km: number, photoId: string | null) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const trusted = usual && usual.trips >= ROUTE_MIN_TRIPS ? usual : null;
  const [km, setKm] = React.useState<number | null>(trusted && tripStart != null ? tripStart + Math.round(trusted.medianKm) : initial);
  const [read, setRead] = React.useState<OdometerPhotoRead | null>(null);
  const [saving, setSaving] = React.useState(false);
  const problem = readingProblem(km, lowest);
  const tripKm = tripStart != null && km != null ? km - tripStart : null;
  const odd = tripKm != null && tripKm >= 0 && (trusted ? isUnusualTrip(tripKm, trusted) : tripKm > LONG_TRIP_KM);
  const needsPhoto = photoRequired && !read;

  async function save() {
    if (km == null || problem || needsPhoto) return;
    setSaving(true);
    const r = await onConfirm(km, read?.photoId ?? null);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error ?? "Couldn't save the reading.");
      return;
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-2">
          {photoRequired && !read && (
            <p className="text-center text-theme-sm font-medium text-foreground">First trip of the day: take a photo of the odometer.</p>
          )}
          <OdometerPhotoButton
            vehicleId={vehicleId}
            stage={stage}
            onRead={(r) => {
              setRead(r);
              if (r.reading != null) setKm(r.reading);
            }}
          />
          <OdometerDrums value={km} onChange={setKm} />
          <PhotoReadNote read={read} />
          <p className="text-center text-theme-xs text-muted-foreground">
            Tap the drums to change them.
            {lowest != null ? ` Last reading ${formatKm(lowest)}.` : ""}
            {tripKm != null && tripKm >= 0 ? ` This trip: ${formatKm(tripKm)}.` : ""}
            {trusted ? ` Usually about ${formatKm(Math.round(trusted.medianKm))} (${trusted.trips} trips).` : ""}
          </p>
          {km != null && problem && <p className="text-center text-theme-xs text-destructive">{problem}</p>}
          {odd && !problem && (
            <p className="text-center text-theme-xs text-warning-foreground">
              {trusted ? `That's far from the usual ${formatKm(Math.round(trusted.medianKm))}.` : `That's ${formatKm(tripKm)} for one trip.`} Check the dashboard before saving.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={km == null || !!problem || needsPhoto || saving} onClick={save}>
            {saving ? "Saving…" : odd ? `Yes, ${formatKm(tripKm)}` : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The Super Admin's correction of an arrived trip (ops.correct_odometer): both readings and why. */
export function CorrectOdometerDialog({
  start,
  end,
  onSave,
  onClose,
}: {
  start: number | null;
  end: number | null;
  onSave: (start: number, end: number | null, reason: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [from, setFrom] = React.useState<number | null>(start);
  const [to, setTo] = React.useState<number | null>(end);
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const problem = from == null ? "Enter the departure reading." : to != null && to < from ? "The arrival reading can't be lower than the departure." : null;

  async function save() {
    if (problem || from == null) return;
    setSaving(true);
    const r = await onSave(from, to, reason);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error ?? "Couldn't correct the reading.");
      return;
    }
    toast.success("Reading corrected");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct the odometer</DialogTitle>
          <DialogDescription>Kept on the record with your name and the reason.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <Field className="items-center">
            <FieldLabel>Departed at</FieldLabel>
            <OdometerDrums value={from} onChange={setFrom} label="Departure reading" />
          </Field>
          <Field className="items-center">
            <FieldLabel>Arrived at</FieldLabel>
            <OdometerDrums value={to} onChange={setTo} label="Arrival reading" />
          </Field>
          {problem && <p className="text-theme-xs text-destructive">{problem}</p>}
        </div>
        <Field>
          <FieldLabel htmlFor="odoReason">Why</FieldLabel>
          <Textarea id="odoReason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Arrival typed 160,761; dashboard showed 160,671" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!problem || reason.trim().length < 5 || saving} onClick={save}>
            {saving ? "Saving…" : "Correct"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
