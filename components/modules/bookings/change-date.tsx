"use client";

import * as React from "react";
import type { PublicBooking, PublicSlot } from "@/lib/types/booking";
import { longDate } from "@/lib/utils/booking-emails";
import { formatTime12 } from "@/lib/utils/time12";
import { ui } from "./public-ui";

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * The group changes its own date (0184): the open slots of the same length, a month at a time, then Confirm. The
 * server checks everything again (the day is open on the booking page, the changes left, the cut-off) and an
 * approved booking goes back to pending approval.
 */
export function ChangeDate({ b, busy, onChange }: { b: PublicBooking; busy: boolean; onChange: (date: string, start: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState(b.date.slice(0, 7));
  const [read, setRead] = React.useState<{ month: string; slots: PublicSlot[] } | null>(null);
  const [pick, setPick] = React.useState<PublicSlot | null>(null);
  const length = minutes(b.end) - minutes(b.start);

  React.useEffect(() => {
    if (!open || !b.placeId) return;
    let live = true;
    fetch(`/api/book?place=${b.placeId}&month=${month}`)
      .then((r) => r.json())
      .then((out: { ok?: boolean; slots?: PublicSlot[] }) => live && setRead({ month, slots: out.ok ? (out.slots ?? []) : [] }))
      .catch(() => live && setRead({ month, slots: [] }));
    return () => {
      live = false;
    };
  }, [open, month, b.placeId]);

  const slots = read?.month === month ? read.slots.filter((s) => s.state === "open" && minutes(s.end) - minutes(s.start) === length) : null;

  return (
    <section className={ui.card}>
      <h2 className={ui.h2}>Need another day?</h2>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed">
        You can change the date until {longDate(b.namesDue)}, {b.dateChangesLeft === 1 ? "once more" : `${b.dateChangesLeft} more times`}. Your program and your volunteers stay as they are.
        {b.status === "approved" ? " The new day needs our approval again, so your booking goes back to pending approval." : ""}
      </p>
      {!open ? (
        <button type="button" className={`${ui.secondary} mt-4`} disabled={busy || !b.placeId} onClick={() => setOpen(true)}>
          Change the date
        </button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={ui.secondary} onClick={() => (setMonth(shift(month, -1)), setPick(null))} aria-label="Earlier month">
              ‹
            </button>
            <p className="min-w-40 text-center text-[15px] font-bold text-[#082f59]">
              {new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })}
            </p>
            <button type="button" className={ui.secondary} onClick={() => (setMonth(shift(month, 1)), setPick(null))} aria-label="Later month">
              ›
            </button>
          </div>
          {slots === null ? (
            <p className="text-[15px]">Looking for open days…</p>
          ) : slots.length === 0 ? (
            <p className="text-[15px]">No open day this month. Try another month.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {slots.map((s) => {
                const on = pick?.date === s.date && pick.start === s.start;
                return (
                  <li key={`${s.date}-${s.start}`}>
                    <button type="button" aria-pressed={on} className={`rounded-2xl border-2 px-3 py-2 text-left text-[14px] ${on ? "border-[#0068c9] bg-[#edf8ff] font-bold text-[#082f59]" : "border-[#c7dce9] text-[#082f59]"}`} onClick={() => setPick(s)}>
                      {longDate(s.date)}
                      <span className="block text-[13px] text-[#436077]">
                        {formatTime12(s.start)} to {formatTime12(s.end)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={ui.primary} disabled={busy || !pick} onClick={() => pick && onChange(pick.date, pick.start)}>
              {pick ? `Move to ${longDate(pick.date)}` : "Choose a day"}
            </button>
            <button type="button" className={ui.secondary} disabled={busy} onClick={() => (setOpen(false), setPick(null))}>
              Keep my date
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
