"use client";

import * as React from "react";
import type { PublicBooking, PublicMember } from "@/lib/types/booking";
import { REQUESTOR_KINDS, durationLabel, participantsLabel } from "@/lib/utils/booking";
import { longDate } from "@/lib/utils/booking-emails";
import { formatTime12 } from "@/lib/utils/time12";
import { StatusPill, ui } from "./public-ui";

/** What each status means for the group, in a sentence. */
function meaning(b: PublicBooking): string {
  switch (b.status) {
    case "pending":
      return `Your slot is held for you while we review your request. We reply within ${b.replyDays} working day${b.replyDays === 1 ? "" : "s"} of the day you asked.`;
    case "approved":
      return "We look forward to your visit. What you need for the day is below.";
    case "declined":
      return "We are sorry that we could not approve this request. You are welcome to ask for another day.";
    case "cancelled":
      return "This booking is cancelled and its slot is free again.";
    case "completed":
      return "Thank you for the time you gave the children.";
    default:
      return "This booking is closed.";
  }
}

type Answer = { booking?: PublicBooking; error?: string };

/** One call to the booking page's server door. */
async function post(body: Record<string, unknown>): Promise<Answer> {
  const res = await fetch("/api/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const out = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; booking?: PublicBooking } | null;
  return res?.ok && out?.ok && out.booking ? { booking: out.booking } : { error: out?.error };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-[#557086]">{label}</dt>
      <dd className="text-[15px] leading-snug break-words text-[#082f59]">{children}</dd>
    </div>
  );
}

/**
 * A group's own page for its booking (0172). The Request ID is the key: with it the group sees the booking and its
 * status (its own email and number masked), and once approved the instructions and who to coordinate with; it gives
 * its volunteers' names until they are due, and may cancel before the day. Each of these is a call to the server,
 * which the database counts per caller.
 */
export function TrackBooking({ initialRef }: { initialRef: string }) {
  const [ref, setRef] = React.useState(initialRef);
  const [booking, setBooking] = React.useState<PublicBooking | null>(null);
  const [busy, setBusy] = React.useState(() => !!initialRef.trim());
  const [error, setError] = React.useState("");
  // The members as typed; null = as the booking holds them. An email shown masked is kept as it is on record.
  const [names, setNames] = React.useState<PublicMember[] | null>(null);
  const [saved, setSaved] = React.useState("");
  const [sure, setSure] = React.useState(false);

  /** Shows the server's answer. */
  function show(out: Answer): PublicBooking | null {
    setBusy(false);
    if (!out.booking) {
      setError(out.error ?? "We could not reach the server. Please check your connection and try again.");
      return null;
    }
    setBooking(out.booking);
    setNames(null);
    setSure(false);
    return out.booking;
  }
  const call = (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setSaved("");
    return post(body).then(show);
  };

  // A link from an email carries the Request ID: open that booking at once (the page starts as "looking").
  React.useEffect(() => {
    let live = true;
    if (initialRef.trim())
      void post({ action: "lookup", ref: initialRef }).then((out) => {
        if (!live) return;
        setBusy(false);
        if (out.booking) setBooking(out.booking);
        else setError(out.error ?? "We could not reach the server. Please check your connection and try again.");
      });
    return () => {
      live = false;
    };
  }, [initialRef]);

  const b = booking;
  const rows: PublicMember[] = names ?? b?.members ?? [];
  const typed = rows.filter((m) => m.name.trim() || m.email.trim());
  const setRow = (i: number, change: Partial<PublicMember>) => setNames(rows.map((m, n) => (n === i ? { ...m, ...change } : m)));
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const incomplete = typed.find((m) => m.name.trim().length < 2 || !(EMAIL.test(m.email.trim()) || m.email.includes("*")));

  return (
    <div className="flex flex-col gap-6">
      <section className={ui.card}>
        <p className={ui.eyebrow}>LAF Activity Center</p>
        <h1 className={ui.h1}>My booking</h1>
        <p className={ui.lead}>Type the Request ID you were given when you sent your request. It looks like LAF-AC-XXXX-XXXX.</p>
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ref.trim()) return;
            setBooking(null); // another Request ID: the booking shown before does not stay on the page
            void call({ action: "lookup", ref });
          }}
        >
          <label className="block w-full sm:w-80">
            <span className={ui.label}>Request ID</span>
            <input className={`${ui.input} tracking-wide uppercase`} value={ref} maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={(e) => setRef(e.target.value)} />
          </label>
          <button type="submit" className={b ? ui.secondary : ui.cta} disabled={busy || !ref.trim()}>
            {busy && !b ? "Looking…" : "Find my booking"}
          </button>
        </form>
        {error ? (
          <p role="alert" className={`${ui.problem} mt-4`}>
            {error}
          </p>
        ) : null}
      </section>

      {b ? (
        <>
          <section className={ui.card} aria-live="polite">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={b.status} />
              <span className="text-[15px] font-bold tracking-wide text-[#082f59]">{b.ref}</span>
            </div>
            <h2 className={`${ui.h2} mt-3`}>{b.requestorName}</h2>
            <p className="mt-2 max-w-prose text-[15px] leading-relaxed">{meaning(b)}</p>
            {b.declineReason ? (
              <p className={`${ui.soft} mt-3`}>
                <strong className="text-[#082f59]">Reason: </strong>
                {b.declineReason}
              </p>
            ) : null}
            <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              <Fact label="Day">{longDate(b.date)}</Fact>
              <Fact label="Time">
                {formatTime12(b.start)} to {formatTime12(b.end)}
              </Fact>
              <Fact label="Place">
                {b.place.name}
                {b.place.whereToGo ? <span className="block text-[#436077]">{b.place.whereToGo}</span> : null}
              </Fact>
              <Fact label="Group">
                {REQUESTOR_KINDS.find((k) => k.key === b.requestorKind)?.label} · {b.volunteersCount} volunteer{b.volunteersCount === 1 ? "" : "s"}
                {b.hasMinors ? " (some under 18)" : ""}
              </Fact>
              <Fact label="Contact person">{b.contactPerson}</Fact>
              <Fact label="We write to">
                {[b.email, b.mobile].filter(Boolean).join(" · ")}
              </Fact>
            </dl>
          </section>

          {b.approved ? (
            <section className={ui.card}>
              <h2 className={ui.h2}>For the day of your visit</h2>
              {b.approved.instructions ? <p className={`${ui.soft} mt-3`}>{b.approved.instructions}</p> : null}
              {b.approved.bookingInstructions ? (
                <>
                  <h3 className={`${ui.label} mt-4`}>For your group</h3>
                  <p className={`${ui.soft} mt-2`}>{b.approved.bookingInstructions}</p>
                </>
              ) : null}
              <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                {b.approved.coordinatorName || b.approved.coordinatorPhone ? (
                  <Fact label="Who to coordinate with">
                    {b.approved.coordinatorName}
                    {b.approved.coordinatorPhone ? <span className="block">{b.approved.coordinatorPhone}</span> : null}
                  </Fact>
                ) : null}
                <Fact label="At the gate">Each volunteer signs the logbook and shows a valid ID.</Fact>
              </dl>
              <p className="mt-5 max-w-prose text-[15px] leading-relaxed">Print the Booking Details sheet and hand it to the guard at the gate. Print it after you have given your volunteers&apos; names, so they are on it.</p>
              <a href={`/api/book/details?ref=${encodeURIComponent(b.ref)}`} target="_blank" rel="noreferrer noopener" className={`${ui.secondary} mt-3`}>
                Open the Booking Details sheet (PDF)
              </a>
            </section>
          ) : null}

          {b.status === "approved" ? (
            <section className={ui.card}>
              <h2 className={ui.h2}>Volunteers&apos; names</h2>
              <p className="mt-2 max-w-prose text-[15px] leading-relaxed">
                The hospital needs the full name of each volunteer for the gate. {b.canEditNames ? `Please give them by ${longDate(b.namesDue)}.` : `They were due on ${longDate(b.namesDue)}. To change them now, please write to us.`}
              </p>
              <p className="mt-2 max-w-prose text-[15px] leading-relaxed">
                Give each volunteer&apos;s full name and email. For a volunteer under 18, give a parent&apos;s or guardian&apos;s email. We keep these to record their volunteer service with Little Ark Foundation.
              </p>
              <div className="mt-4 flex flex-col gap-3">
                <p className={ui.label}>
                  Volunteers ({typed.length} of {b.volunteersCount})
                </p>
                {rows.map((m, i) => (
                  <div key={i} className="grid gap-2 rounded-2xl border border-[#c7dce9] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <label className="block">
                      <span className="sr-only">Volunteer {i + 1}: full name</span>
                      <input className={ui.input} placeholder="Full name" value={m.name} maxLength={120} disabled={!b.canEditNames || busy} onChange={(e) => setRow(i, { name: e.target.value })} />
                    </label>
                    <label className="block">
                      <span className="sr-only">Volunteer {i + 1}: email</span>
                      <input className={ui.input} type="email" inputMode="email" placeholder="Email" value={m.email} maxLength={200} disabled={!b.canEditNames || busy} onFocus={() => m.email.includes("*") && setRow(i, { email: "" })} onChange={(e) => setRow(i, { email: e.target.value })} />
                    </label>
                    <label className="flex items-center gap-2 self-center text-[15px] text-[#082f59]">
                      <input type="checkbox" className="size-5 accent-[#0068c9]" checked={m.under18} disabled={!b.canEditNames || busy} onChange={(e) => setRow(i, { under18: e.target.checked })} />
                      Under 18
                    </label>
                  </div>
                ))}
                {b.canEditNames && rows.length < b.volunteersCount ? (
                  <button type="button" className={`${ui.secondary} self-start`} disabled={busy} onClick={() => setNames([...rows, { name: "", email: "", under18: false }])}>
                    Add a volunteer
                  </button>
                ) : null}
                <p className={ui.hint}>An email shown with stars is kept as it is. Click into it to type a new one.</p>
              </div>
              {incomplete ? <p className={`${ui.problem} mt-3`}>Please give the full name and the email of {incomplete.name.trim() || "each volunteer"}.</p> : null}
              {b.canEditNames ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" className={ui.primary} disabled={busy || names === null || !!incomplete || typed.length > b.volunteersCount} onClick={() => void call({ action: "names", ref: b.ref, names: typed.map((m) => ({ name: m.name.trim(), email: m.email.trim(), under18: m.under18 })) }).then((ok) => ok && setSaved("The names are saved. Thank you."))}>
                    Save the names
                  </button>
                  {saved ? (
                    <p role="status" className="text-[15px] font-bold text-[#082f59]">
                      {saved}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className={ui.card}>
            <h2 className={ui.h2}>Program flow</h2>
            <ol className="mt-4 flex flex-col gap-3">
              {b.items.map((i) => (
                <li key={`${i.start}-${i.activity}`} className="rounded-2xl border border-[#c7dce9] p-4">
                  <p className="text-[13px] font-bold tracking-wide text-[#0068c9] uppercase">
                    {formatTime12(i.start)} to {formatTime12(i.end)} · {durationLabel(i.start, i.end)}
                  </p>
                  <p className="mt-1 text-lg leading-tight font-black text-[#082f59]">{i.activity}</p>
                  <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                    {i.purpose ? <Fact label="Purpose">{i.purpose}</Fact> : null}
                    <Fact label="Participants">{participantsLabel(i)}</Fact>
                    {i.materials ? <Fact label="Materials needed">{i.materials}</Fact> : null}
                  </dl>
                </li>
              ))}
            </ol>
            {b.offPlan && b.status === "pending" ? <p className={`${ui.hint} mt-3`}>An activity here is not in the hospital&apos;s approved plan for the month, so we confirm it with the hospital before approving.</p> : null}
          </section>

          {b.canCancel ? (
            <section className={ui.card}>
              <h2 className={ui.h2}>Can&apos;t make it?</h2>
              <p className="mt-2 max-w-prose text-[15px] leading-relaxed">Please cancel as early as you can, so another group can take the slot.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {sure ? (
                  <>
                    <button type="button" className={ui.primary} disabled={busy} onClick={() => void call({ action: "cancel", ref: b.ref })}>
                      Yes, cancel this booking
                    </button>
                    <button type="button" className={ui.secondary} disabled={busy} onClick={() => setSure(false)}>
                      Keep it
                    </button>
                  </>
                ) : (
                  <button type="button" className={ui.secondary} onClick={() => setSure(true)}>
                    Cancel this booking
                  </button>
                )}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
