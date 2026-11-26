"use client";

import * as React from "react";
import type { PublicMember } from "@/lib/types/booking";
import { PublicMemberRows, incompleteMember } from "./public-members";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { PublicBookingForm, PublicSlot, SlotState } from "@/lib/types/booking";
import { REQUESTOR_KINDS, durationLabel, flowProblems, monthWeeks, shiftMonth } from "@/lib/utils/booking";
import { longDate } from "@/lib/utils/booking-emails";
import { addDays } from "@/lib/utils/dtr";
import { formatTime12 } from "@/lib/utils/time12";
import { ui } from "./public-ui";

/** One activity of the program flow, as typed. `choice` is "plan:<id>", "list:<name>" or "other" (suggested). */
interface Row {
  key: number;
  choice: string;
  custom: string;
  purpose: string;
  who: "patients" | "carers" | "both";
  ages: string;
  gender: "all" | "girls" | "boys";
  start: string;
  end: string;
  materials: string;
}

/** What a day that can't be booked says. */
const DAY_WORD: Record<SlotState, string> = { open: "Open", pending: "On hold", booked: "Booked", closed: "Closed", holiday: "Holiday", too_soon: "Too soon", too_far: "Opens later", past: "" };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const row = (key: number, start: string, end: string): Row => ({ key, choice: "", custom: "", purpose: "", who: "patients", ages: "", gender: "all", start, end, materials: "" });

/**
 * The public booking form (0172): choose an open slot, say who is coming, build the program flow (1 to 3
 * activities inside the slot), agree to the guidelines, send. The page checks what it can so a group is told at
 * once; the database checks everything again when the request is filed, and its word is final.
 */
export function BookForm({ form, prefill }: { form: PublicBookingForm; prefill?: { name: string; kind: string; contactPerson: string; email: string; mobile: string } | null }) {
  const { settings: st } = form;
  const firstMonth = addDays(form.today, st.minDaysAhead).slice(0, 7);
  const lastMonth = addDays(form.today, st.maxDaysAhead).slice(0, 7);
  const [placeId, setPlaceId] = React.useState(form.places[0].id);
  const [month, setMonth] = React.useState(firstMonth);
  // The month's slots, kept with what they were read for: another place or month shows "loading" until its own arrive.
  const [read, setRead] = React.useState<{ key: string; slots: PublicSlot[] } | null>(null);
  const [reload, setReload] = React.useState(0);
  const [day, setDay] = React.useState<string | null>(null);
  const [slot, setSlot] = React.useState<PublicSlot | null>(null);
  const [who, setWho] = React.useState({ requestorName: prefill?.name ?? "", requestorKind: prefill?.kind ?? "organization", contactPerson: prefill?.contactPerson ?? "", email: prefill?.email ?? "", mobile: prefill?.mobile ?? "" });
  const [rows, setRows] = React.useState<Row[]>([row(1, "", "")]);
  const [members, setMembers] = React.useState<PublicMember[]>([{ name: "", email: "", under18: false }]);
  const named = members.filter((m) => m.name.trim() || m.email.trim());
  const [agree, setAgree] = React.useState({ guidelines: false, privacy: false });
  const [website, setWebsite] = React.useState("");
  const [problems, setProblems] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<{ ref: string; replyDays: number; confirmBy: string | null } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const problemsRef = React.useRef<HTMLDivElement>(null);
  const nextKey = React.useRef(2);

  const readKey = `${placeId}|${month}|${reload}`;
  const slots = read?.key === readKey ? read.slots : null;

  React.useEffect(() => {
    let live = true;
    fetch(`/api/book?place=${placeId}&month=${month}`)
      .then((r) => r.json())
      .then((out: { ok?: boolean; slots?: PublicSlot[] }) => live && setRead({ key: readKey, slots: out.ok ? (out.slots ?? []) : [] }))
      .catch(() => live && setRead({ key: readKey, slots: [] }));
    return () => {
      live = false;
    };
  }, [placeId, month, readKey]);

  const place = form.places.find((p) => p.id === placeId) ?? form.places[0];
  const daySlots = (d: string) => (slots ?? []).filter((s) => s.date === d);
  const planItems = slot ? (form.plans.find((p) => p.placeId === placeId && p.month === slot.date.slice(0, 7))?.items ?? []).filter((i) => i.onDate === slot.date) : [];
  const nameOf = (r: Row) => (r.choice.startsWith("plan:") ? (planItems.find((i) => `plan:${i.id}` === r.choice)?.activity ?? "") : r.choice.startsWith("list:") ? r.choice.slice(5) : r.custom.trim());
  const patch = (key: number, change: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));

  function choose(s: PublicSlot) {
    setSlot(s);
    // A program not yet started takes the whole slot; one already typed keeps its times and is checked against the new slot.
    setRows((all) => (all.length === 1 && !all[0].choice ? [{ ...all[0], start: s.start, end: s.end }] : all.map((r) => ({ ...r, choice: r.choice.startsWith("plan:") ? "" : r.choice }))));
  }
  function pickDay(d: string) {
    setDay(d);
    const open = daySlots(d).filter((s) => s.state === "open");
    if (open.length === 1) choose(open[0]);
    else setSlot(null);
  }
  function pickActivity(r: Row, choice: string) {
    const item = planItems.find((i) => `plan:${i.id}` === choice);
    // A plan activity brings its purpose, materials and planned time, unless the group already typed its own.
    patch(r.key, { choice, ...(item ? { purpose: r.purpose || item.purpose, materials: r.materials || item.materials, ...(item.start && item.end ? { start: item.start, end: item.end } : {}) } : {}) });
  }

  function check(): string[] {
    const out: string[] = [];
    if (!slot) out.push("Choose a day and a time slot.");
    if (who.requestorName.trim().length < 2) out.push("Tell us who is asking: your name, or the name of your group.");
    if (who.contactPerson.trim().length < 2) out.push("Give the name of a contact person.");
    if (!EMAIL.test(who.email.trim())) out.push("Give an email address we can write to.");
    if (who.mobile.replace(/\D/g, "").length < 7) out.push("Give a contact number.");
    if (named.length < 1 || named.length > st.maxVolunteers) out.push(`Give the full name and email of each volunteer: 1 to ${st.maxVolunteers}.`);
    const missing = incompleteMember(named);
    if (missing) out.push(`Give the full name and the email of ${missing.name.trim() || "each volunteer"}. For a volunteer under 18, a parent's or guardian's email.`);
    if (slot) out.push(...flowProblems(rows.map((r) => ({ activity: nameOf(r), start: r.start, end: r.end })), slot.start, slot.end));
    rows.forEach((r, i) => r.purpose.trim().length < 3 && out.push(`Activity ${i + 1}: please say its purpose.`));
    if (!agree.guidelines || !agree.privacy) out.push("Please tick both boxes: the visit guidelines and the privacy notice.");
    return out;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const found = check();
    if (found.length || !slot) {
      setProblems(found);
      return void requestAnimationFrame(() => problemsRef.current?.focus());
    }
    setBusy(true);
    const res = await fetch("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "request",
        website,
        place_id: placeId,
        date: slot.date,
        start_time: slot.start,
        requestor_name: who.requestorName.trim(),
        requestor_kind: who.requestorKind,
        contact_person: who.contactPerson.trim(),
        email: who.email.trim(),
        mobile: who.mobile.trim(),
        members: named.map((m) => ({ name: m.name.trim(), email: m.email.trim(), under18: m.under18 })),
        agree_guidelines: agree.guidelines,
        agree_privacy: agree.privacy,
        items: rows.map((r) => ({
          source: r.choice.startsWith("plan:") ? "plan" : r.choice.startsWith("list:") ? "list" : "suggested",
          plan_item_id: r.choice.startsWith("plan:") ? r.choice.slice(5) : "",
          activity: nameOf(r),
          purpose: r.purpose.trim(),
          who: r.who,
          ages: r.ages.trim(),
          gender: r.gender,
          start_time: r.start,
          end_time: r.end,
          materials: r.materials.trim(),
        })),
      }),
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; ref?: string; replyDays?: number; confirmBy?: string | null } | null;
    setBusy(false);
    if (!res?.ok || !out?.ok || !out.ref) {
      setProblems([out?.error ?? "We could not send your request. Please check your connection and try again."]);
      setReload((n) => n + 1); // the slot may have just been taken: show the month as it is now
      return void requestAnimationFrame(() => problemsRef.current?.focus());
    }
    setDone({ ref: out.ref, replyDays: out.replyDays ?? st.replyDays, confirmBy: out.confirmBy ?? null });
    window.scrollTo({ top: 0 });
  }

  if (done) {
    return (
      <section className={ui.card} aria-live="polite">
        <p className={ui.eyebrow}>Request sent</p>
        <h1 className={ui.h1}>Thank you. Your request is in.</h1>
        <p className={ui.lead}>
          Your slot is held for you while we review it.{" "}
          {done.confirmBy ? `We will confirm your booking by ${longDate(done.confirmBy)}.` : `We will email you within ${done.replyDays} working day${done.replyDays === 1 ? "" : "s"}.`}
        </p>
        <div className="mt-6 rounded-2xl bg-[#f2f9fd] p-5">
          <p className={ui.label}>Your Request ID</p>
          <p className="mt-1 text-2xl font-black tracking-wide break-all text-[#082f59] select-all sm:text-3xl">{done.ref}</p>
          <p className={ui.hint}>Keep this. It opens your booking, where you can follow it, correct your volunteers&apos; names, change the date or cancel.</p>
          <button type="button" className={`${ui.secondary} mt-3`} onClick={() => void navigator.clipboard?.writeText(done.ref).then(() => setCopied(true))}>
            {copied ? "Copied" : "Copy the Request ID"}
          </button>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/book/track?ref=${encodeURIComponent(done.ref)}`} className={ui.primary}>
            See my booking
          </Link>
          <a href="/book" className={ui.secondary}>
            Book another visit
          </a>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={send} noValidate className="flex flex-col gap-6">
      <section>
        <p className={ui.eyebrow}>LAF Activity Center</p>
        <h1 className={ui.h1}>Book a time with the children</h1>
        <p className={ui.lead}>
          Bring a story, a song, a craft or a quiet game to children in treatment and their families. Choose an open day, tell us about your group and your program, and we will reply within {st.replyDays} working day{st.replyDays === 1 ? "" : "s"}.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2 text-[13px] font-bold text-[#082f59]">
          {["One group per slot", `Up to ${st.maxVolunteers} volunteers`, `Book ${st.minDaysAhead} to ${st.maxDaysAhead} days ahead`].map((t) => (
            <li key={t} className="rounded-full border border-[#c7dce9] bg-white px-3.5 py-1.5">
              {t}
            </li>
          ))}
        </ul>
      </section>

      <section className={ui.card} aria-labelledby="step-day">
        <h2 id="step-day" className={ui.h2}>
          1. Choose a day
        </h2>
        {form.places.length > 1 ? (
          <label className="mt-4 block">
            <span className={ui.label}>Place</span>
            <select
              className={ui.input}
              value={placeId}
              onChange={(e) => {
                setPlaceId(e.target.value);
                setDay(null);
                setSlot(null);
              }}
            >
              {form.places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="mt-3 text-[15px] leading-snug">
          <strong className="text-[#082f59]">{place.name}</strong>
          {place.whereToGo ? <span> · {place.whereToGo}</span> : null}
        </p>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button type="button" className={`${ui.secondary} px-3`} aria-label="The month before" disabled={month <= firstMonth} onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <p className="text-lg font-black text-[#082f59]" aria-live="polite">
            {new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })}
          </p>
          <button type="button" className={`${ui.secondary} px-3`} aria-label="The month after" disabled={month >= lastMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>

        <div className="-mx-1 mt-3 grid grid-cols-7 gap-0.5 sm:mx-0 sm:gap-1.5" aria-busy={slots === null}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="pb-1 text-center text-[11px] font-bold tracking-wide text-[#557086] uppercase sm:text-xs">
              {d}
            </div>
          ))}
          {monthWeeks(month)
            .flat()
            .map((d, i) => {
              if (!d) return <div key={`x${i}`} />;
              const of = daySlots(d);
              const open = of.some((s) => s.state === "open");
              const word = open ? "Open" : of[0] ? DAY_WORD[of[0].state] : "";
              const cell = "flex aspect-square flex-col items-center justify-center rounded-xl text-sm sm:aspect-auto sm:min-h-16 sm:text-base";
              if (!open)
                return (
                  <div key={d} className={`${cell} ${word ? "bg-[#f2f9fd] text-[#557086]" : "text-[#557086]/50"}`}>
                    <span>{Number(d.slice(8))}</span>
                    {word ? <span className="hidden text-[11px] leading-tight sm:block">{word}</span> : null}
                  </div>
                );
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={day === d}
                  aria-label={`${longDate(d)}: open`}
                  onClick={() => pickDay(d)}
                  className={`${cell} border-2 border-[#0068c9] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#082f59] ${day === d ? "bg-[#0068c9] text-white" : "bg-white text-[#082f59] hover:bg-[#edf8ff]"}`}
                >
                  <span>{Number(d.slice(8))}</span>
                  <span className="hidden text-[11px] leading-tight font-bold sm:block">Open</span>
                </button>
              );
            })}
        </div>
        <p className={`${ui.hint} mt-3`}>
          {slots === null ? "Loading the month…" : "Days with a blue border are open. Grey days are booked, on hold for another group, closed, or outside the booking window."}
        </p>

        {day ? (
          <div className="mt-5 rounded-2xl bg-[#f2f9fd] p-4">
            <p className={ui.label}>{longDate(day)}</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Time slots">
              {daySlots(day).map((s) =>
                s.state === "open" ? (
                  <button
                    key={s.start}
                    type="button"
                    aria-pressed={slot?.date === s.date && slot.start === s.start}
                    onClick={() => choose(s)}
                    className={`rounded-full border-2 border-[#0068c9] px-4 py-2 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#082f59] ${slot?.date === s.date && slot.start === s.start ? "bg-[#0068c9] text-white" : "bg-white text-[#0068c9] hover:bg-[#edf8ff]"}`}
                  >
                    {formatTime12(s.start)} to {formatTime12(s.end)}
                  </button>
                ) : (
                  <span key={s.start} className="rounded-full border border-[#c7dce9] bg-white px-4 py-2 text-sm text-[#557086]">
                    {formatTime12(s.start)} to {formatTime12(s.end)} · {DAY_WORD[s.state]}
                  </span>
                ),
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className={ui.card} aria-labelledby="step-group">
        <h2 id="step-group" className={ui.h2}>
          2. About your group
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className={ui.label}>Name of requestor</span>
            <input className={ui.input} value={who.requestorName} maxLength={120} autoComplete="organization" onChange={(e) => setWho({ ...who, requestorName: e.target.value })} />
            <span className={`${ui.hint} block`}>A person, a company, a school, a church or an organization.</span>
          </label>
          <label className="block">
            <span className={ui.label}>You are</span>
            <select className={ui.input} value={who.requestorKind} onChange={(e) => setWho({ ...who, requestorKind: e.target.value })}>
              {REQUESTOR_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={ui.label}>Contact person</span>
            <input className={ui.input} value={who.contactPerson} maxLength={120} autoComplete="name" onChange={(e) => setWho({ ...who, contactPerson: e.target.value })} />
          </label>
          <label className="block">
            <span className={ui.label}>Email</span>
            <input className={ui.input} type="email" inputMode="email" value={who.email} maxLength={200} autoComplete="email" readOnly={!!prefill} onChange={(e) => setWho({ ...who, email: e.target.value })} />
            <span className={`${ui.hint} block`}>{prefill ? "Your group's email in the Volunteers Portal: the booking goes to your group." : "We write to this address about your booking."}</span>
          </label>
          <label className="block">
            <span className={ui.label}>Contact number</span>
            <input className={ui.input} type="tel" inputMode="tel" value={who.mobile} maxLength={40} autoComplete="tel" onChange={(e) => setWho({ ...who, mobile: e.target.value })} />
          </label>
        </div>
        <div className="mt-6">
          <p className={ui.label}>
            Your volunteers ({named.length} of up to {st.maxVolunteers})
          </p>
          <p className={`${ui.hint} mb-3 block`}>
            The full name and email of each volunteer, for the hospital&apos;s gate and their volunteer record. For a volunteer under 18, a parent&apos;s or guardian&apos;s email. You can correct them on your booking page until {st.namesDueDays} day{st.namesDueDays === 1 ? "" : "s"} before the visit.
          </p>
          <PublicMemberRows rows={members} onChange={setMembers} max={st.maxVolunteers} />
        </div>
        {/* Not for people: left empty by anyone who can see the page. */}
        <div className="absolute -left-[9999px]" aria-hidden>
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
      </section>

      <section className={ui.card} aria-labelledby="step-flow">
        <h2 id="step-flow" className={ui.h2}>
          3. Your program flow
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed">
          One to three activities{slot ? `, between ${formatTime12(slot.start)} and ${formatTime12(slot.end)}` : " inside your slot"}.
          {planItems.length ? " The activities in the hospital-approved plan for that day are offered first." : ""} You may also choose from our list or suggest your own; we then confirm it with the hospital before approving.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          {rows.map((r, i) => (
            <fieldset key={r.key} className="rounded-2xl border border-[#c7dce9] p-4">
              <legend className="flex w-full items-center justify-between gap-3 px-1 text-sm font-black text-[#082f59]">
                <span>
                  Activity {i + 1}
                  {durationLabel(r.start, r.end) ? <span className="ml-2 font-normal text-[#557086]">Total duration: {durationLabel(r.start, r.end)}</span> : null}
                </span>
                {rows.length > 1 ? (
                  <button type="button" className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[13px] font-bold text-[#0068c9] hover:bg-[#edf8ff] focus-visible:outline-2 focus-visible:outline-[#0068c9]" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </button>
                ) : null}
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className={ui.label}>Activity name</span>
                  <select className={ui.input} value={r.choice} onChange={(e) => pickActivity(r, e.target.value)}>
                    <option value="">Choose an activity</option>
                    {planItems.length ? (
                      <optgroup label="In the hospital-approved plan for this day">
                        {planItems.map((p) => (
                          <option key={p.id} value={`plan:${p.id}`}>
                            {p.activity}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    <optgroup label="From our list">
                      {form.activities.map((a) => (
                        <option key={a} value={`list:${a}`}>
                          {a}
                        </option>
                      ))}
                    </optgroup>
                    <option value="other">Suggest another activity</option>
                  </select>
                </label>
                {r.choice === "other" ? (
                  <label className="block sm:col-span-2">
                    <span className={ui.label}>Your suggested activity</span>
                    <input className={ui.input} value={r.custom} maxLength={80} onChange={(e) => patch(r.key, { custom: e.target.value })} />
                  </label>
                ) : null}
                <label className="block sm:col-span-2">
                  <span className={ui.label}>Purpose</span>
                  <input className={ui.input} value={r.purpose} maxLength={300} placeholder="What you hope the children take from it" onChange={(e) => patch(r.key, { purpose: e.target.value })} />
                </label>
                <label className="block">
                  <span className={ui.label}>Participants</span>
                  <select className={ui.input} value={r.who} onChange={(e) => patch(r.key, { who: e.target.value as Row["who"] })}>
                    <option value="patients">Patients only</option>
                    <option value="both">Patients and their carers</option>
                    <option value="carers">Carers only</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className={ui.label}>Ages</span>
                    <input className={ui.input} value={r.ages} maxLength={40} placeholder="All, or 4 to 12" onChange={(e) => patch(r.key, { ages: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className={ui.label}>For</span>
                    <select className={ui.input} value={r.gender} onChange={(e) => patch(r.key, { gender: e.target.value as Row["gender"] })}>
                      <option value="all">Girls and boys</option>
                      <option value="girls">Girls</option>
                      <option value="boys">Boys</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className={ui.label}>Start time</span>
                  <input className={ui.input} type="time" value={r.start} min={slot?.start} max={slot?.end} step={300} onChange={(e) => patch(r.key, { start: e.target.value })} />
                </label>
                <label className="block">
                  <span className={ui.label}>End time</span>
                  <input className={ui.input} type="time" value={r.end} min={slot?.start} max={slot?.end} step={300} onChange={(e) => patch(r.key, { end: e.target.value })} />
                </label>
                <label className="block sm:col-span-2">
                  <span className={ui.label}>Materials needed</span>
                  <textarea className={ui.area} value={r.materials} maxLength={500} placeholder="What you will bring. Write None if nothing is needed." onChange={(e) => patch(r.key, { materials: e.target.value })} />
                </label>
              </div>
            </fieldset>
          ))}
        </div>
        {rows.length < 3 ? (
          <button type="button" className={`${ui.secondary} mt-4`} onClick={() => setRows([...rows, row(nextKey.current++, rows[rows.length - 1].end, slot?.end ?? "")])}>
            <Plus className="size-4" aria-hidden /> Add an activity
          </button>
        ) : null}
      </section>

      <section className={ui.card} aria-labelledby="step-agree">
        <h2 id="step-agree" className={ui.h2}>
          4. Before you send
        </h2>
        <h3 className={`${ui.label} mt-4`}>Guidelines for your visit</h3>
        <p className={`${ui.soft} mt-2`}>{st.guidelines}</p>
        {st.prohibited ? (
          <>
            <h3 className={`${ui.label} mt-4`}>Not allowed</h3>
            <p className={`${ui.soft} mt-2`}>{st.prohibited}</p>
          </>
        ) : null}
        <label className="mt-4 flex items-start gap-3 text-[15px] leading-snug text-[#082f59]">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[#0068c9]" checked={agree.guidelines} onChange={(e) => setAgree({ ...agree, guidelines: e.target.checked })} />
          Our group has read the guidelines and will follow them.
        </label>
        <h3 className={`${ui.label} mt-5`}>Privacy notice</h3>
        <p className={`${ui.soft} mt-2`}>{st.privacyNotice}</p>
        <label className="mt-4 flex items-start gap-3 text-[15px] leading-snug text-[#082f59]">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[#0068c9]" checked={agree.privacy} onChange={(e) => setAgree({ ...agree, privacy: e.target.checked })} />I agree to the use of these details for this booking.
        </label>

        {problems.length ? (
          <div ref={problemsRef} tabIndex={-1} role="alert" className={`${ui.problem} mt-5 focus:outline-none`}>
            <p className="font-bold">Please check {problems.length === 1 ? "this" : "these"} before sending:</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="submit" className={ui.cta} disabled={busy}>
            {busy ? "Sending…" : "Send my request"}
          </button>
          {slot ? (
            <p className="text-[15px] leading-snug text-[#082f59]">
              {longDate(slot.date)}
              <br />
              {formatTime12(slot.start)} to {formatTime12(slot.end)}
            </p>
          ) : null}
        </div>
      </section>
    </form>
  );
}
