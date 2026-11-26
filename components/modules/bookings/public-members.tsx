"use client";

import type { PublicMember } from "@/lib/types/booking";
import { ui } from "./public-ui";

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The first volunteer typed without a full name or a usable email (one shown with stars is the one on record). */
export const incompleteMember = (rows: PublicMember[]): PublicMember | undefined =>
  rows.filter((m) => m.name.trim() || m.email.trim()).find((m) => m.name.trim().length < 2 || !(EMAIL.test(m.email.trim()) || m.email.includes("*")));

/**
 * A group's volunteers on the public pages (0181, 0184): full name, email (a parent's or guardian's for anyone under
 * 18) and Under 18, one row each, with "Add a volunteer" up to `max` and a way to take a row out. Used when the
 * request is filed and on the group's own booking page.
 */
export function PublicMemberRows({ rows, onChange, max, disabled = false }: { rows: PublicMember[]; onChange: (rows: PublicMember[]) => void; max: number; disabled?: boolean }) {
  const setRow = (i: number, change: Partial<PublicMember>) => onChange(rows.map((m, n) => (n === i ? { ...m, ...change } : m)));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((m, i) => (
        <div key={i} className="grid gap-2 rounded-2xl border border-[#c7dce9] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
          <label className="block">
            <span className="sr-only">Volunteer {i + 1}: full name</span>
            <input className={ui.input} placeholder="Full name" value={m.name} maxLength={120} disabled={disabled} onChange={(e) => setRow(i, { name: e.target.value })} />
          </label>
          <label className="block">
            <span className="sr-only">Volunteer {i + 1}: email</span>
            <input className={ui.input} type="email" inputMode="email" placeholder="Email" value={m.email} maxLength={200} disabled={disabled} onFocus={() => m.email.includes("*") && setRow(i, { email: "" })} onChange={(e) => setRow(i, { email: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 self-center text-[15px] text-[#082f59]">
            <input type="checkbox" className="size-5 accent-[#0068c9]" checked={m.under18} disabled={disabled} onChange={(e) => setRow(i, { under18: e.target.checked })} />
            Under 18
          </label>
          {rows.length > 1 && !disabled ? (
            <button type="button" className="self-center text-[14px] font-bold text-[#0068c9] underline-offset-2 hover:underline" onClick={() => onChange(rows.filter((_, n) => n !== i))}>
              Remove
            </button>
          ) : (
            <span className="hidden sm:block" />
          )}
        </div>
      ))}
      {!disabled && rows.length < max ? (
        <button type="button" className={`${ui.secondary} self-start`} onClick={() => onChange([...rows, { name: "", email: "", under18: false }])}>
          Add a volunteer
        </button>
      ) : null}
    </div>
  );
}
