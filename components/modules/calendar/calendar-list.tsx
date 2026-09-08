"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Table2 } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/date";
import type { CalendarEvent } from "@/lib/types/calendar";

/** The sheet's own venue chip. Free text that is not one of the known
 * venues falls to the neutral tone rather than being hidden. */
export function VenueBadge({ venue }: { venue?: string }) {
  if (!venue) return <span className="text-muted-foreground">—</span>;
  return <StatusBadge domain="venue" status={venue.toLowerCase()} label={venue} />;
}

/**
 * The list view: the sheet's columns, in the sheet's order, on top of the
 * shared DataTable. The period control lives in the table's toolbar slot so
 * search and period sit on one line. The Date cell is merged over a day's
 * rows (events arrive ordered by date, so a day's rows are adjacent).
 */
export function CalendarList({
  events,
  canEdit,
  canEditEvent,
  onOpen,
  toolbar,
  emptyMessage,
}: {
  events: CalendarEvent[];
  /** Whether this viewer may edit anything at all -- shows the actions column. */
  canEdit: boolean;
  /** Whether this particular event is editable (sheet events are not while the sync is on). */
  canEditEvent: (event: CalendarEvent) => boolean;
  /** Opens the event -- to edit, or read-only, as the page decides. */
  onOpen: (event: CalendarEvent) => void;
  toolbar?: React.ReactNode;
  emptyMessage: string;
}) {
  const columns: ColumnDef<CalendarEvent>[] = [
    {
      id: "date",
      header: "Date",
      accessorFn: (e) => e.date,
      cell: ({ row }) => (
        <div className="flex flex-col leading-tight">
          <span className="whitespace-nowrap font-medium">{formatDate(row.original.date, "EEE, MMM d")}</span>
          <span className="text-[11px] text-muted-foreground">{row.original.date.slice(0, 4)}</span>
        </div>
      ),
    },
    { id: "time", header: "Time", accessorFn: (e) => e.time ?? "", cell: ({ row }) => row.original.time ?? <span className="text-muted-foreground">—</span> },
    {
      id: "title",
      header: "Event",
      accessorFn: (e) => e.title,
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <span className={row.original.isHoliday ? "font-medium text-amber-700 dark:text-amber-400" : "font-medium"}>{row.original.title}</span>
          {row.original.source === "sheet" ? <Table2 className="size-3 shrink-0 text-muted-foreground" aria-label="From the Google Sheet" /> : null}
        </span>
      ),
    },
    { id: "venue", header: "Venue", accessorFn: (e) => e.venue ?? "", cell: ({ row }) => <VenueBadge venue={row.original.venue} /> },
    { id: "officer", header: "Officer on duty", accessorFn: (e) => e.officerOnDuty ?? "", cell: ({ row }) => row.original.officerOnDuty ?? <span className="text-muted-foreground">—</span> },
    { id: "staff", header: "Staff needed", accessorFn: (e) => e.staffNeeded ?? "", cell: ({ row }) => row.original.staffNeeded ?? <span className="text-muted-foreground">—</span> },
    { id: "booked", header: "Booked by", accessorFn: (e) => e.bookedBy ?? "", cell: ({ row }) => row.original.bookedBy ?? <span className="text-muted-foreground">—</span> },
    { id: "contact", header: "Contact", accessorFn: (e) => e.contactInfo ?? "", cell: ({ row }) => row.original.contactInfo ?? <span className="text-muted-foreground">—</span> },
    {
      id: "remarks",
      header: "Remarks",
      accessorFn: (e) => e.remarks ?? "",
      cell: ({ row }) =>
        row.original.remarks ? (
          <span className="block max-w-[28ch] truncate" title={row.original.remarks}>
            {row.original.remarks}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    ...(canEdit
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }) =>
              canEditEvent(row.original) ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${row.original.title}`} onClick={() => onOpen(row.original)}>
                  <Pencil className="size-3.5" />
                </Button>
              ) : null,
          } satisfies ColumnDef<CalendarEvent>,
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      data={events}
      searchPlaceholder="Search events, venues, people…"
      toolbar={toolbar}
      emptyMessage={emptyMessage}
      pageSize={25}
      onRowClick={onOpen}
      mergeColumnId="date"
    />
  );
}
