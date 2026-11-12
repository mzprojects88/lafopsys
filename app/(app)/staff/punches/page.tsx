"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { format, parseISO } from "date-fns";
import { Download, MoreHorizontal, PencilLine, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { LoadingState } from "@/components/patterns/loading-state";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { SectionCard } from "@/components/patterns/section-card";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { ClearFilters, FilterSelect, useFilters } from "@/components/patterns/filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LocationCell } from "@/components/modules/staff/punch-cells";
import { PunchPhotoCell } from "@/components/modules/staff/punch-photo-cell";
import { PunchTimeDialog, type PunchTimeValue } from "@/components/modules/staff/punch-time-dialog";
import { decideCorrection } from "@/components/modules/staff/correction-requests-panel";
import { useCollection } from "@/lib/data/collection-store";
import { useDtrSessions } from "@/lib/hooks/use-dtr-sessions";
import { useCorrectionRequests } from "@/lib/hooks/use-correction-requests";
import { punchDeletionsStore } from "@/lib/hooks/use-punch-deletions-collection";
import { timePunchesStore } from "@/lib/hooks/use-time-punches-collection";
import { timeEntriesStore } from "@/lib/hooks/use-time-entries-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr, holdsPower } from "@/lib/rbac/roles";
import { ROLES } from "@/lib/types/common";
import type { TimePunch } from "@/lib/types/staff";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { addDays, dayKey, effectiveStatus, formatMinutes, sessionMinutes, timeLabel, timeLabel12, type DtrSession } from "@/lib/utils/dtr";
import { instantOn } from "@/lib/utils/dtr-prompts";
import { optionsOf } from "@/lib/utils/filters";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

type PairStatus = "complete" | "open" | "waiting" | "missing" | "no_in";
const STATUS: Record<PairStatus, { label: string; className: string }> = {
  complete: { label: "Complete", className: STATUS_TONE_CLASSES.neutral },
  open: { label: "In progress", className: STATUS_TONE_CLASSES.positive },
  waiting: { label: "OUT waiting for approval", className: STATUS_TONE_CLASSES.warning },
  missing: { label: "Missing OUT", className: STATUS_TONE_CLASSES.negative },
  no_in: { label: "No IN", className: STATUS_TONE_CLASSES.negative },
};

interface PairRow {
  id: string;
  session: DtrSession;
  staffId: string;
  staffName: string;
  isDriver: boolean;
  dateLabel: string;
  inPunch?: TimePunch;
  outPunch?: TimePunch;
  /** A missed clock-out request still to decide, for this day. */
  request?: { id: string; requestedAt: string; reason: string };
  minutes: number;
  status: PairStatus;
}

type Dialog =
  | { kind: "add" }
  | { kind: "add_out"; row: PairRow }
  | { kind: "edit"; row: PairRow; punch: TimePunch }
  | { kind: "request"; row: PairRow }
  | { kind: "delete"; row: PairRow; punch: TimePunch }
  | { kind: "approve"; row: PairRow }
  | { kind: "reject"; row: PairRow };

/** POSTs to a punch route; true when it worked (with the toasts). */
async function send(url: string, body: object, done: string): Promise<{ ok: boolean; timeEntryId?: string }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const r = (await res?.json().catch(() => null)) as { ok: boolean; error?: string; warning?: string | null; timeEntryId?: string } | null;
  if (!r?.ok) {
    toast.error(r?.error ?? (res ? `The server refused it (${res.status}): try again.` : "No connection: try again."));
    return { ok: false };
  }
  if (r.warning) toast.warning(r.warning);
  else if (done) toast.success(done);
  await Promise.all([timePunchesStore.refetch(), punchDeletionsStore.refetch(), timeEntriesStore.refetch()]);
  return { ok: true, timeEntryId: r.timeEntryId };
}

export default function PunchesPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <Punches />
    </React.Suspense>
  );
}

/**
 * Staff & Time › Punches (0146): every IN beside its OUT for the period (Today by default), and what each IN is
 * still missing. Everyone sees their own (RLS) and asks for a missed clock-out; those who manage punches see
 * everyone's, add, change and delete punches with a reason, and decide the requests on the row.
 */
function Punches() {
  const { role, roles, isHr, staffId: myId } = useRole();
  const manages = holdsPower(roles, "manage_punches") || isHr;
  const readsAll = manages || holdsPower(roles, "finance_work");
  const canSeePhotos = canManageHr(role, isHr);
  const period = usePeriodPresets("punches", "today", true);
  const from = period.window?.from ?? "";
  const to = period.window?.to ?? "";
  const { sessions, punches, loading, now } = useDtrSessions();
  const { requests, reportMissedClockOut } = useCorrectionRequests();
  const { data: changes } = useCollection(punchDeletionsStore);
  const { staff } = useStaffRoster();
  const f = useFilters("staff", "role", "status");
  const [dialog, setDialog] = React.useState<Dialog | null>(null);

  const person = React.useCallback((id: string) => staff.find((s) => s.id === id), [staff]);
  const staffName = React.useCallback((id: string) => ((p) => (p ? `${p.firstName} ${p.lastName}` : "Unknown staff"))(person(id)), [person]);

  const rows: PairRow[] = React.useMemo(() => {
    const byId = new Map(punches.map((p) => [p.id, p]));
    const waiting = new Map(requests.filter((r) => r.status === "pending" && r.punchType === "clock_out").map((r) => [r.timeEntryId, r]));
    const out: PairRow[] = [];
    for (const s of sessions) {
      if ((from && s.dayKey < from) || (to && s.dayKey > to)) continue;
      const p = person(s.staffId);
      const request = s.timeEntryId && s.status !== "closed" ? waiting.get(s.timeEntryId) : undefined;
      const st = effectiveStatus(s, now);
      const status: PairStatus = st === "closed" ? "complete" : st === "orphan_out" ? "no_in" : st === "open" ? "open" : request ? "waiting" : "missing";
      const row: PairRow = {
        id: s.id,
        session: s,
        staffId: s.staffId,
        staffName: staffName(s.staffId),
        isDriver: !!p && holdsPower([p.role, ...p.extraRoles], "driver"),
        dateLabel: format(parseISO(s.dayKey), "EEE, MMM d, yyyy"),
        inPunch: s.clockInAt ? byId.get(s.id) : undefined,
        outPunch: s.clockOutId ? byId.get(s.clockOutId) : undefined,
        request: request ? { id: request.id, requestedAt: request.requestedAt, reason: request.reason } : undefined,
        minutes: sessionMinutes(s, now),
        status,
      };
      if (f.values.staff !== "all" && row.staffId !== f.values.staff) continue;
      if (f.values.role !== "all" && p?.role !== f.values.role) continue;
      if (f.values.status !== "all" && row.status !== f.values.status) continue;
      out.push(row);
    }
    return out.reverse();
  }, [sessions, punches, requests, from, to, now, person, staffName, f.values]);

  // A punch whose time was changed: its time before the first change (the log is newest first).
  const editedFrom = React.useMemo(() => {
    const m = new Map<string, { was: string; reason: string }>();
    for (const c of changes) if (c.action === "edited") m.set(c.punchId, { was: c.punchedAt, reason: c.reason });
    return m;
  }, [changes]);

  const count = (s: PairStatus) => rows.filter((r) => r.status === s).length;
  const actions = (row: PairRow) => {
    const items: { label: string; open: Dialog; destructive?: boolean }[] = [];
    if (manages) {
      if (row.inPunch) items.push({ label: "Change the IN time", open: { kind: "edit", row, punch: row.inPunch } });
      if (row.outPunch) items.push({ label: "Change the OUT time", open: { kind: "edit", row, punch: row.outPunch } });
      if (row.request && row.staffId !== myId) {
        items.push({ label: "Approve the OUT", open: { kind: "approve", row } }, { label: "Reject the request", open: { kind: "reject", row } });
      }
      if (!row.outPunch && row.inPunch && !row.request) items.push({ label: "Add the OUT", open: { kind: "add_out", row } });
      if (row.outPunch) items.push({ label: "Delete the OUT", open: { kind: "delete", row, punch: row.outPunch }, destructive: true });
      else if (row.inPunch) items.push({ label: "Delete the IN", open: { kind: "delete", row, punch: row.inPunch }, destructive: true });
    }
    return items;
  };
  const mayRequest = (row: PairRow) => row.staffId === myId && row.status === "missing" && !!row.session.timeEntryId;

  function PunchCell({ row, punch, side }: { row: PairRow; punch?: TimePunch; side: "in" | "out" }) {
    if (!punch) {
      if (side === "in") return <span className="text-muted-foreground">—</span>;
      if (row.request) return <span className="text-warning-foreground dark:text-warning">Asked: {timeLabel12(row.request.requestedAt)}</span>;
      return row.status === "open" ? <span className="text-muted-foreground">Still in</span> : <span className="font-medium text-destructive">Missing</span>;
    }
    const edited = editedFrom.get(punch.id);
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium tabular-nums">{timeLabel12(punch.punchedAt)}</span>
          {dayKey(punch.punchedAt) !== row.session.dayKey ? <span className="text-theme-xs text-muted-foreground">next day</span> : null}
          {punch.source === "adjustment" ? <Badge variant="outline" className="gap-1" title={punch.adjustmentReason}><PencilLine className="size-3" />Added</Badge> : null}
          {edited ? <Badge variant="outline" title={`Was ${timeLabel12(edited.was)}: ${edited.reason}`}>Edited</Badge> : null}
        </div>
        <div className="text-theme-xs"><LocationCell punch={punch} isDriver={row.isDriver} /></div>
        {canSeePhotos ? <PunchPhotoCell punch={punch} caption={`${row.staffName} · ${row.dateLabel} ${timeLabel12(punch.punchedAt)}`} /> : null}
      </div>
    );
  }

  function RowActions({ row }: { row: PairRow }) {
    const items = actions(row);
    return (
      <div className="flex items-center justify-end gap-1">
        {mayRequest(row) ? <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "request", row })}>Ask for the OUT</Button> : null}
        {items.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Actions"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {items.map((i) => (
                <DropdownMenuItem key={i.label} variant={i.destructive ? "destructive" : "default"} onSelect={() => setDialog(i.open)}>{i.label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  const columns: ColumnDef<PairRow>[] = [
    {
      id: "staff",
      header: "Staff",
      accessorFn: (r) => r.staffName,
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <PersonAvatar name={row.original.staffName} size="sm" />
          <span className="font-medium">{row.original.staffName}</span>
        </div>
      ),
    },
    { id: "date", header: "Date", accessorFn: (r) => r.session.dayKey, cell: ({ row }) => row.original.dateLabel },
    { id: "in", header: "IN", accessorFn: (r) => r.session.clockInAt ?? "", cell: ({ row }) => <PunchCell row={row.original} punch={row.original.inPunch} side="in" /> },
    { id: "out", header: "OUT", accessorFn: (r) => r.session.clockOutAt ?? "", cell: ({ row }) => <PunchCell row={row.original} punch={row.original.outPunch} side="out" /> },
    { id: "hours", header: "Hours", accessorFn: (r) => r.minutes, cell: ({ row }) => <span className="tabular-nums">{formatMinutes(row.original.minutes)}</span> },
    { id: "status", header: "Status", accessorFn: (r) => STATUS[r.status].label, cell: ({ row }) => <Badge className={STATUS[row.original.status].className}>{STATUS[row.original.status].label}</Badge> },
    { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <RowActions row={row.original} /> },
  ];

  function exportCsv() {
    downloadCsv(
      csvLines(
        ["Staff", "Date", "IN", "OUT", "Hours", "Minutes", "Status"],
        rows.map((r) => [
          r.staffName,
          r.session.dayKey,
          r.inPunch ? timeLabel12(r.inPunch.punchedAt) : "",
          r.outPunch ? timeLabel12(r.outPunch.punchedAt) : r.request ? `Asked ${timeLabel12(r.request.requestedAt)}` : "",
          formatMinutes(r.minutes),
          String(r.minutes),
          STATUS[r.status].label,
        ])
      ),
      `punches-${from || "all"}-${to || "all"}.csv`
    );
  }

  // The OUT the dialog adds is on the session's day, or the next morning when earlier than its IN.
  const outDay = (row: PairRow, time: string) => (row.session.clockInAt && time < timeLabel(row.session.clockInAt) ? addDays(row.session.dayKey, 1) : row.session.dayKey);

  async function save(d: Dialog, v: PunchTimeValue): Promise<boolean> {
    if (d.kind === "add") {
      const first = await send("/api/dtr/adjust", { type: "clock_in", staffId: v.staffId, date: v.date, time: v.time, reason: v.reason }, v.outTime ? "" : "IN added");
      if (!first.ok || !v.outTime) return first.ok;
      const date = v.outTime < v.time ? addDays(v.date, 1) : v.date;
      return (await send("/api/dtr/adjust", { timeEntryId: first.timeEntryId, date, time: v.outTime, reason: v.reason }, "IN and OUT added")).ok;
    }
    if (d.kind === "add_out") return (await send("/api/dtr/adjust", { timeEntryId: d.row.session.timeEntryId, date: v.date, time: v.time, reason: v.reason }, "OUT added")).ok;
    if (d.kind === "edit") return (await send("/api/dtr/punch/edit", { punchId: d.punch.id, date: v.date, time: v.time, reason: v.reason }, "Time changed; the original is in the log")).ok;
    if (d.kind === "request") {
      const r = await reportMissedClockOut(d.row.session.timeEntryId!, instantOn(v.date, v.time), v.reason);
      if (!r.ok) toast.error(r.error);
      else toast.success("Asked; those who manage punches will decide");
      return r.ok;
    }
    return false;
  }

  const roster = staff.filter((s) => s.active).map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}` }));
  const shownStaff = optionsOf(staff.filter((s) => punches.some((p) => p.staffId === s.id)), (s) => s.id, (id) => staffName(id));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Punches"
        description={readsAll ? "Every IN beside its OUT. Each IN needs its OUT, or a request waiting for approval." : "Your INs and OUTs. Each IN needs its OUT: if you forgot one, ask for it here."}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {manages ? <Button onClick={() => setDialog({ kind: "add" })}><Plus /> Add punch</Button> : null}
            <Button variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="size-4" /> Export CSV</Button>
          </div>
        }
      />
      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} allowAll />
      <div className="flex flex-wrap items-end gap-2">
        {readsAll ? <FilterSelect all="All staff" value={f.values.staff} onChange={f.set("staff")} options={shownStaff} className="w-48" /> : null}
        {readsAll ? <FilterSelect all="All roles" value={f.values.role} onChange={f.set("role")} options={optionsOf(staff, (s) => s.role, (v) => ROLES.find((r) => r.value === v)?.label ?? v)} className="w-44" /> : null}
        <FilterSelect all="Any status" value={f.values.status} onChange={f.set("status")} options={(Object.keys(STATUS) as PairStatus[]).map((k) => ({ value: k, label: STATUS[k].label }))} className="w-52" />
        <ClearFilters active={f.active} onClear={f.clear} />
      </div>
      {rows.length ? (
        <p className="text-theme-sm text-muted-foreground">
          {rows.length} IN/OUT {rows.length === 1 ? "pair" : "pairs"} · <span className={count("missing") ? "font-medium text-destructive" : ""}>{count("missing")} missing OUT</span> · {count("waiting")} waiting for approval · {count("open")} in progress
          {count("no_in") ? ` · ${count("no_in")} OUT with no IN` : ""}
        </p>
      ) : null}

      {loading ? (
        <LoadingState />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          searchPlaceholder="Search staff…"
          pageSize={25}
          emptyMessage="No punches in this period."
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-theme-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <PersonAvatar name={row.staffName} size="sm" />
                  <span className="truncate font-medium">{row.staffName}</span>
                </div>
                <Badge className={STATUS[row.status].className}>{STATUS[row.status].label}</Badge>
              </div>
              <div className="text-theme-xs text-muted-foreground">{row.dateLabel} · {formatMinutes(row.minutes)}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="mb-1 text-theme-xs text-muted-foreground">IN</div><PunchCell row={row} punch={row.inPunch} side="in" /></div>
                <div><div className="mb-1 text-theme-xs text-muted-foreground">OUT</div><PunchCell row={row} punch={row.outPunch} side="out" /></div>
              </div>
              <RowActions row={row} />
            </div>
          )}
        />
      )}

      {manages && changes.length ? (
        <SectionCard flush title="Punch changes" description="Times changed and punches deleted, with the reason and who did it. The latest 200.">
          <ul className="divide-y divide-border">
            {changes.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-3 gap-y-1 px-5 py-2.5 text-theme-sm">
                <span className="font-medium">{c.staffId ? staffName(c.staffId) : "—"}</span>
                <span>
                  {c.punchType === "clock_out" ? "OUT" : "IN"} {format(parseISO(dayKey(c.punchedAt)), "MMM d, yyyy")} {timeLabel12(c.punchedAt)}
                  {c.action === "edited" && c.newPunchedAt ? ` → ${dayKey(c.newPunchedAt) !== dayKey(c.punchedAt) ? `${format(parseISO(dayKey(c.newPunchedAt)), "MMM d")} ` : ""}${timeLabel12(c.newPunchedAt)}` : " deleted"}
                </span>
                <span className="text-muted-foreground">
                  {format(parseISO(dayKey(c.deletedAt)), "MMM d, yyyy")} {timeLabel12(c.deletedAt)} by {c.deletedBy ? staffName(c.deletedBy) : "the system"}: {c.reason}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {dialog?.kind === "add" ? (
        <PunchTimeDialog title="Add punch" description="A punch nobody made: marked Added, signed with your name and the reason." confirmLabel="Add" date={to && to < period.today ? to : period.today} staff={roster} onClose={() => setDialog(null)} onSubmit={(v) => save(dialog, v)} />
      ) : null}
      {dialog?.kind === "add_out" ? (
        <PunchTimeDialog title={`Add ${dialog.row.staffName}'s OUT`} description={`IN at ${dialog.row.inPunch ? timeLabel12(dialog.row.inPunch.punchedAt) : ""} on ${dialog.row.dateLabel}. The OUT is marked Added and signed with your name.`} confirmLabel="Add OUT" date={dialog.row.session.dayKey} onClose={() => setDialog(null)} onSubmit={(v) => save(dialog, { ...v, date: v.date === dialog.row.session.dayKey ? outDay(dialog.row, v.time) : v.date })} />
      ) : null}
      {dialog?.kind === "edit" ? (
        <PunchTimeDialog title={`Change ${dialog.row.staffName}'s ${dialog.punch.punchType === "clock_in" ? "IN" : "OUT"}`} description={`Now ${timeLabel12(dialog.punch.punchedAt)}. The original time stays in the punch log with your reason.`} confirmLabel="Change time" date={dayKey(dialog.punch.punchedAt)} time={timeLabel(dialog.punch.punchedAt)} onClose={() => setDialog(null)} onSubmit={(v) => save(dialog, v)} />
      ) : null}
      {dialog?.kind === "request" ? (
        <PunchTimeDialog title="Ask for your OUT" description={`You clocked in at ${dialog.row.inPunch ? timeLabel12(dialog.row.inPunch.punchedAt) : ""} on ${dialog.row.dateLabel}. When did you leave?`} confirmLabel="Ask" date={dialog.row.session.dayKey} onClose={() => setDialog(null)} onSubmit={(v) => save(dialog, { ...v, date: v.date === dialog.row.session.dayKey ? outDay(dialog.row, v.time) : v.date })} />
      ) : null}
      <ReasonDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Delete this punch"
        description={dialog?.kind === "delete" ? `${dialog.row.staffName}, ${dialog.punch.punchType === "clock_in" ? "IN" : "OUT"} at ${timeLabel12(dialog.punch.punchedAt)} on ${dialog.row.dateLabel}. Only for a punch made by mistake: it leaves the record, its photo is removed, and the deletion is logged with your reason.` : ""}
        confirmLabel="Delete punch"
        requireReason
        minLength={3}
        destructive
        onConfirm={(reason) => {
          if (dialog?.kind === "delete") void send("/api/dtr/punch/delete", { punchId: dialog.punch.id, reason }, "Punch deleted; the deletion is logged");
        }}
      />
      <ReasonDialog
        open={dialog?.kind === "approve"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Approve the OUT"
        description={dialog?.kind === "approve" && dialog.row.request ? `${dialog.row.staffName} asks for ${timeLabel12(dialog.row.request.requestedAt)}: "${dialog.row.request.reason}". A note is optional.` : ""}
        confirmLabel="Approve"
        requireReason={false}
        onConfirm={(note) => {
          if (dialog?.kind === "approve" && dialog.row.request) void decideCorrection(dialog.row.request.id, "approve", note);
        }}
      />
      <ReasonDialog
        open={dialog?.kind === "reject"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reject the request"
        description={dialog?.kind === "reject" && dialog.row.request ? `${dialog.row.staffName} asks for ${timeLabel12(dialog.row.request.requestedAt)}. Say why; they see it and can ask again.` : ""}
        confirmLabel="Reject"
        requireReason
        minLength={3}
        destructive
        onConfirm={(note) => {
          if (dialog?.kind === "reject" && dialog.row.request) void decideCorrection(dialog.row.request.id, "reject", note);
        }}
      />
    </div>
  );
}
