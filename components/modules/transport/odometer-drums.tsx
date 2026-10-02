"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatKm, odometerDigits, parseOdometer, readingProblem } from "@/lib/utils/odometer";

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

// ponytail: a fixed "that's a long trip" prompt; phase C replaces it with the km learned per route.
const LONG_TRIP_KM = 300;

/** Depart / arrive with the odometer: the drums prefilled, Confirm when they match the dashboard. */
export function OdometerDialog({
  title,
  description,
  initial,
  lowest,
  tripStart,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  initial: number | null;
  /** The reading may not be below this (the vehicle's last, or this trip's departure). */
  lowest: number | null;
  /** On arrival: the departure reading, to show this trip's km. */
  tripStart?: number | null;
  confirmLabel: string;
  onConfirm: (km: number) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [km, setKm] = React.useState<number | null>(initial);
  const [saving, setSaving] = React.useState(false);
  const problem = readingProblem(km, lowest);
  const tripKm = tripStart != null && km != null ? km - tripStart : null;
  const long = tripKm != null && tripKm > LONG_TRIP_KM;

  async function save() {
    if (km == null || problem) return;
    setSaving(true);
    const r = await onConfirm(km);
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
          <OdometerDrums value={km} onChange={setKm} />
          <p className="text-center text-theme-xs text-muted-foreground">
            Tap the drums to change them.
            {lowest != null ? ` Last reading ${formatKm(lowest)}.` : ""}
            {tripKm != null && tripKm >= 0 ? ` This trip: ${formatKm(tripKm)}.` : ""}
          </p>
          {km != null && problem && <p className="text-center text-theme-xs text-destructive">{problem}</p>}
          {long && !problem && (
            <p className="text-center text-theme-xs text-warning-foreground">That&apos;s {formatKm(tripKm)} for one trip. Check the dashboard before saving.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={km == null || !!problem || saving} onClick={save}>
            {saving ? "Saving…" : long ? `Yes, ${formatKm(tripKm)}` : confirmLabel}
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
