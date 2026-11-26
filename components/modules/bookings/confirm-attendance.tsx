"use client";

import * as React from "react";
import { ui } from "./public-ui";

interface Member {
  id: string;
  name: string;
  under18: boolean;
  came: boolean;
}

/**
 * The group confirms or corrects who came to a visit (0183), from the Volunteers Portal Home, while the visit is
 * inside the days allowed: tick who came, untick who did not, add someone who came but was not listed. The server
 * takes the group from the session and checks the visit is the group's.
 */
export function ConfirmAttendance({ refId, members, until, open }: { refId: string; members: Member[]; until: string; open: boolean }) {
  const [came, setCame] = React.useState<Record<string, boolean>>(() => Object.fromEntries(members.map((m) => [m.id, m.came])));
  const [added, setAdded] = React.useState<{ name: string; email: string; under18: boolean }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const changed = members.some((m) => came[m.id] !== m.came) || added.some((a) => a.name.trim() || a.email.trim());

  if (!open) {
    return (
      <div className="mt-3 rounded-xl bg-[#f2f9fd] px-3 py-2 text-[14px] leading-relaxed">
        <p className="font-bold text-[#082f59]">Who came</p>
        <p>{members.length ? members.filter((m) => m.came).map((m) => m.name).join(", ") || "Nobody was marked as having come." : "No names were given for this visit."}</p>
        <p className="mt-1 text-[13px] text-[#557086]">To change this now, please write to us.</p>
      </div>
    );
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/book/portal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "attendance",
        ref: refId,
        marks: members.filter((m) => came[m.id] !== m.came).map((m) => ({ id: m.id, came: came[m.id] })),
        added: added.filter((a) => a.name.trim() || a.email.trim()).map((a) => ({ name: a.name.trim(), email: a.email.trim(), under18: a.under18 })),
      }),
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !out?.ok) return void setMessage({ ok: false, text: out?.error ?? "We could not reach the server. Please check your connection and try again." });
    window.location.reload();
  }

  return (
    <div className="mt-3 rounded-xl border border-[#c7dce9] p-3">
      <p className="text-[15px] font-bold text-[#082f59]">Confirm who came</p>
      <p className="text-[13px] text-[#557086]">Untick anyone who could not come, and add anyone who came but was not listed. You can do this until {new Date(`${until}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })}.</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {members.map((m) => (
          <li key={m.id}>
            <label className="flex items-center gap-2 text-[15px] text-[#082f59]">
              <input type="checkbox" className="size-5 accent-[#0068c9]" checked={came[m.id]} disabled={busy} onChange={(e) => setCame({ ...came, [m.id]: e.target.checked })} />
              {m.name}
              {m.under18 ? <span className="text-[13px] text-[#557086]">· under 18</span> : null}
            </label>
          </li>
        ))}
      </ul>
      {added.map((a, i) => (
        <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="block">
            <span className="sr-only">Added person {i + 1}: full name</span>
            <input className={ui.input} placeholder="Full name" value={a.name} maxLength={120} onChange={(e) => setAdded(added.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))} />
          </label>
          <label className="block">
            <span className="sr-only">Added person {i + 1}: email</span>
            <input className={ui.input} type="email" inputMode="email" placeholder="Email" value={a.email} maxLength={200} onChange={(e) => setAdded(added.map((x, n) => (n === i ? { ...x, email: e.target.value } : x)))} />
          </label>
          <label className="flex items-center gap-2 self-center text-[15px] text-[#082f59]">
            <input type="checkbox" className="size-5 accent-[#0068c9]" checked={a.under18} onChange={(e) => setAdded(added.map((x, n) => (n === i ? { ...x, under18: e.target.checked } : x)))} />
            Under 18
          </label>
        </div>
      ))}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={ui.secondary} disabled={busy} onClick={() => setAdded([...added, { name: "", email: "", under18: false }])}>
          Add someone who came
        </button>
        <button type="button" className={ui.primary} disabled={busy || !changed} onClick={save}>
          {busy ? "Saving…" : "Save who came"}
        </button>
      </div>
      {message ? (
        <p role="alert" className={`${ui.problem} mt-3`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
