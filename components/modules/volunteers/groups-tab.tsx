"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { PortalAccess } from "@/components/modules/volunteers/portal-access";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBookingGroups, useBookingRequests, useBookingSetup } from "@/lib/hooks/use-bookings-collection";
import type { BookingGroup, BookingRequest, BookingVolunteer } from "@/lib/types/booking";
import { BOOKING_STATUS_LABEL, REQUESTOR_KINDS } from "@/lib/utils/booking";
import { formatDate, todayIso } from "@/lib/utils/date";

interface GroupRow {
  group: BookingGroup;
  bookings: BookingRequest[];
  visits: number;
  upcoming: number;
  members: { name: string; email: string; under18: boolean; times: number }[];
  hours: number;
  lastVisit: string;
}

const hoursLabel = (h: number) => (h ? `${Math.round(h * 100) / 100} h` : "—");

/** Each group with its bookings and the people it brought, counted from the visits staff recorded. */
function groupRows(groups: BookingGroup[], requests: BookingRequest[], members: BookingVolunteer[], today: string): GroupRow[] {
  return groups.map((group) => {
    const bookings = requests.filter((r) => r.groupId === group.id).sort((a, b) => b.date.localeCompare(a.date));
    const held = bookings.filter((r) => r.status === "completed");
    const people = new Map<string, GroupRow["members"][number]>();
    for (const m of members.filter((x) => bookings.some((b) => b.id === x.requestId))) {
      const key = `${m.name.toLowerCase()}|${m.email}`;
      const came = held.some((b) => b.id === m.requestId) && m.came !== false;
      const row = people.get(key) ?? { name: m.name, email: m.email, under18: m.under18, times: 0 };
      people.set(key, { ...row, times: row.times + (came ? 1 : 0) });
    }
    return {
      group,
      bookings,
      visits: held.length,
      upcoming: bookings.filter((r) => r.status === "approved" && r.date >= today).length,
      members: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
      hours: held.reduce((n, r) => n + (r.attendedHours ?? 0), 0),
      lastVisit: held[0]?.date ?? "",
    };
  });
}

/**
 * Volunteers › Groups (0181): one per contact email, made when a group books. Visits held, what is coming, the
 * people it brought and the hours of its visits. Opening a group shows its bookings and its members.
 */
export function GroupsTab({ canEdit }: { canEdit: boolean }) {
  const { groups, loading } = useBookingGroups();
  const { requests, volunteers } = useBookingRequests();
  const { places } = useBookingSetup();
  const [search, setSearch] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const today = todayIso();
  const rows = groupRows(groups, requests, volunteers, today).sort((a, b) => (b.lastVisit || b.bookings[0]?.date || "").localeCompare(a.lastVisit || a.bookings[0]?.date || ""));
  const term = search.trim().toLowerCase();
  const shown = term ? rows.filter((r) => [r.group.name, r.group.contactPerson, r.group.email, r.group.mobile, ...r.members.map((m) => m.name)].some((v) => v.toLowerCase().includes(term))) : rows;
  const open = rows.find((r) => r.group.id === openId) ?? null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="max-w-prose text-theme-sm text-muted-foreground">Made when a group books a visit, one per contact email. Visits and hours count the visits staff recorded.</p>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Group, contact or member" className="pl-9" aria-label="Search the groups" />
        </div>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Visits held</TableHead>
              <TableHead className="text-right">Upcoming</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead>Last visit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {loading ? "Loading…" : term ? "No group matches that search." : "No group yet. A group appears here when it books a visit."}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((r) => (
                <TableRow key={r.group.id} tabIndex={0} className="cursor-pointer" onClick={() => setOpenId(r.group.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(r.group.id)}>
                  <TableCell className="min-w-48 whitespace-normal">
                    <span className="font-medium">{r.group.name}</span>
                    <div className="text-theme-xs text-muted-foreground">{REQUESTOR_KINDS.find((k) => k.key === r.group.kind)?.label}</div>
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal">
                    {r.group.contactPerson}
                    <div className="text-theme-xs text-muted-foreground">{[r.group.email || "No email", r.group.mobile].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.visits || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.upcoming || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.members.length || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{hoursLabel(r.hours)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.lastVisit ? formatDate(r.lastVisit) : "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {open ? (
            <>
              <DialogHeader>
                <DialogTitle>{open.group.name}</DialogTitle>
                <DialogDescription>
                  {[open.group.contactPerson, open.group.email || "No email (no portal access)", open.group.mobile].filter(Boolean).join(" · ")}
                </DialogDescription>
              </DialogHeader>
              <section className="flex min-w-0 flex-col gap-2">
                <h4 className="text-theme-sm font-medium text-foreground">Bookings</h4>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <Table>
                    <TableBody>
                      {open.bookings.map((b) => (
                        <TableRow key={b.id} className="hover:bg-transparent">
                          <TableCell className="whitespace-nowrap">{formatDate(b.date, "EEE, MMM d, yyyy")}</TableCell>
                          <TableCell className="min-w-40 whitespace-normal">{places.find((p) => p.id === b.placeId)?.name}</TableCell>
                          <TableCell>
                            <StatusBadge domain="booking" status={b.status} label={BOOKING_STATUS_LABEL[b.status]} />
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap text-muted-foreground">{b.status === "completed" ? `${b.attendedVolunteers ?? 0} came · ${hoursLabel(b.attendedHours ?? 0)}` : b.seqNo}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
              <PortalAccess key={open.group.id} groupId={open.group.id} hasEmail={!!open.group.email} canEdit={canEdit} />
              <section className="flex min-w-0 flex-col gap-2">
                <h4 className="text-theme-sm font-medium text-foreground">Members</h4>
                {open.members.length === 0 ? (
                  <p className="text-theme-sm text-muted-foreground">No member given yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-theme-sm">
                    {open.members.map((m) => (
                      <li key={`${m.name}|${m.email}`} className="flex flex-wrap justify-between gap-x-4">
                        <span className="text-foreground">
                          {m.name}
                          {m.under18 ? <span className="text-muted-foreground"> · under 18</span> : null}
                        </span>
                        <span className="text-muted-foreground">
                          {m.email} · {m.times ? `came ${m.times} time${m.times === 1 ? "" : "s"}` : "no visit recorded yet"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
