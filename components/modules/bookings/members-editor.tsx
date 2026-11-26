"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { MemberInput } from "@/lib/hooks/use-bookings-collection";
import type { BookingVolunteer } from "@/lib/types/booking";

type Row = MemberInput & { key: string };
const fromMember = (v: BookingVolunteer): Row => ({ key: v.id, id: v.id, name: v.name, email: v.email, under18: v.under18, came: v.came });

/**
 * The members of a booking's group, for staff (0181): full name and email (a parent's or guardian's for a member
 * under 18) and, once the visit is recorded, whether each one came. Saved row by row by the page, so a member
 * nobody touched keeps its "did not come" mark and the volunteer it was credited to. The dialog gives this a key
 * per booking, so nothing half-typed carries over.
 */
export function MembersEditor({ members, count, recorded, canEdit, busy, onSave }: { members: BookingVolunteer[]; count: number; recorded: boolean; canEdit: boolean; busy: boolean; onSave: (rows: MemberInput[]) => Promise<boolean> }) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const shown = rows ?? members.map(fromMember);
  const nextKey = React.useRef(0);
  const patch = (key: string, change: Partial<Row>) => setRows(shown.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const filled = shown.filter((r) => r.name.trim() || r.email.trim()).length;

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-theme-sm font-medium text-foreground">
          Members <span className="font-normal text-muted-foreground">({filled} of {count})</span>
        </h4>
        <p className="text-theme-xs text-muted-foreground">Full name and email; for a member under 18, a parent&apos;s or guardian&apos;s email. NCH needs the names for the gate.</p>
      </div>
      {shown.length === 0 ? <p className="text-theme-sm text-muted-foreground">None given yet. The group gives them on its booking page with the Request ID, or you add them here.</p> : null}
      <div className="flex flex-col gap-2">
        {shown.map((r, i) => (
          <div key={r.key} className="grid min-w-0 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto]">
            <Input aria-label={`Member ${i + 1}: full name`} placeholder="Full name" value={r.name} maxLength={120} disabled={!canEdit} onChange={(e) => patch(r.key, { name: e.target.value })} />
            <Input aria-label={`Member ${i + 1}: email`} placeholder="Email" inputMode="email" value={r.email} maxLength={200} disabled={!canEdit} onChange={(e) => patch(r.key, { email: e.target.value })} />
            <label className="flex items-center gap-1.5 text-theme-sm whitespace-nowrap text-foreground">
              <Checkbox checked={r.under18} disabled={!canEdit} onCheckedChange={(v) => patch(r.key, { under18: v === true })} />
              Under 18
            </label>
            {recorded ? (
              <label className="flex items-center gap-1.5 text-theme-sm whitespace-nowrap text-foreground">
                <Checkbox checked={r.came !== false} disabled={!canEdit} onCheckedChange={(v) => patch(r.key, { came: v === true })} />
                Came
              </label>
            ) : (
              <span className="hidden sm:block" />
            )}
            {canEdit ? (
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove member ${i + 1}`} onClick={() => setRows(shown.filter((x) => x.key !== r.key))}>
                <Trash2 className="size-4" />
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {shown.length < count ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setRows([...shown, { key: `new${nextKey.current++}`, name: "", email: "", under18: false, came: null }])}>
              <Plus className="size-4" /> Add a member
            </Button>
          ) : null}
          {rows !== null ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onSave(rows.map((r) => ({ id: r.id, name: r.name, email: r.email, under18: r.under18, came: r.came }))).then((ok) => ok && setRows(null))}>
              Save the members
            </Button>
          ) : null}
        </div>
      ) : null}
      {recorded ? <p className="text-theme-xs text-muted-foreground">Unticking Came takes the visit off that volunteer&apos;s record; the group can also confirm who came for 7 days after the visit.</p> : null}
    </section>
  );
}
