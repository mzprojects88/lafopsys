"use client";

import * as React from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronsUpDown, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DataTableProps<TData> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- column value type is intentionally open; each column's `cell` renderer narrows it
  columns: ColumnDef<TData, any>[];
  data: TData[];
  searchPlaceholder?: string;
  searchKey?: string;
  onRowClick?: (row: TData) => void;
  toolbar?: React.ReactNode;
  emptyMessage?: string;
  pageSize?: number;
  /**
   * Overrides the generic card built from the column defs for the below-`sm` layout.
   * Only worth passing when the generic version reads poorly for a particular table --
   * every table gets a usable card without it.
   */
  renderMobileCard?: (row: TData) => React.ReactNode;
}

/**
 * A column's header, but only when it's a plain string we can use as a field label.
 * The `id: "actions"` columns in this codebase carry `header: ""`, which is the signal
 * to move that cell into the card's footer instead of labelling it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches ColumnDef's own open value type
function headerLabel(column: { columnDef: ColumnDef<any, any> }): string | undefined {
  const header = column.columnDef.header;
  return typeof header === "string" && header.trim().length > 0 ? header : undefined;
}

export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder = "Search…",
  onRowClick,
  toolbar,
  emptyMessage = "No results.",
  pageSize = 10,
  renderMobileCard,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const pageCount = Math.max(1, table.getPageCount());
  const pageIndex = table.getState().pagination.pageIndex;
  const pageNumbers = Array.from({ length: pageCount }).map((_, i) => i);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 rounded-full pl-8"
          />
        </div>
        {toolbar}
        <span className="ml-auto text-xs text-muted-foreground">
          {table.getFilteredRowModel().rows.length} of {data.length}
        </span>
      </div>

      {/* Below `sm` a 6-8 column table is unreadable even with its own horizontal scroll,
          so each row becomes a card instead. Rendered as a sibling and toggled with CSS
          rather than a JS breakpoint hook, which would flash the wrong layout on first
          paint. Cards reuse each column's own `cell` renderer, so avatars, status badges
          and formatted dates carry over unchanged. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => {
            if (renderMobileCard) {
              return <React.Fragment key={row.id}>{renderMobileCard(row.original)}</React.Fragment>;
            }
            const cells = row.getVisibleCells();
            const [titleCell, ...restCells] = cells;
            const fieldCells = restCells.filter((cell) => headerLabel(cell.column));
            const footerCells = restCells.filter((cell) => !headerLabel(cell.column));
            return (
              <div
                key={row.id}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={() => onRowClick?.(row.original)}
                onKeyDown={(e) => {
                  if (!onRowClick) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(row.original);
                  }
                }}
                className={cn(
                  "flex flex-col gap-2.5 rounded-xl border bg-card p-3 text-sm",
                  onRowClick && "cursor-pointer transition-colors hover:bg-accent/40"
                )}
              >
                {titleCell && (
                  <div className="min-w-0 font-medium">
                    {flexRender(titleCell.column.columnDef.cell, titleCell.getContext())}
                  </div>
                )}
                {fieldCells.length > 0 && (
                  <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                    {fieldCells.map((cell) => (
                      <React.Fragment key={cell.id}>
                        <dt className="truncate text-muted-foreground">{headerLabel(cell.column)}</dt>
                        <dd className="min-w-0 break-words text-foreground">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
                {footerCells.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t pt-2.5">
                    {footerCells.map((cell) => (
                      <React.Fragment key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="rounded-xl border bg-card px-3 py-10 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        )}
      </div>

      <div className="hidden overflow-hidden rounded-xl border bg-card sm:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="h-10 py-2 text-xs">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className={cn(
                          "flex items-center gap-1 font-semibold",
                          header.column.getCanSort() && "cursor-pointer select-none"
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <ChevronsUpDown className="size-3 text-muted-foreground" />
                        )}
                      </button>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => onRowClick?.(row.original)}
                  className={cn("py-2 text-sm", onRowClick && "cursor-pointer")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Page {pageIndex + 1} of {pageCount}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8 rounded-full"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          {pageNumbers.length <= 7 ? (
            pageNumbers.map((i) => (
              <Button
                key={i}
                variant={i === pageIndex ? "default" : "outline"}
                size="icon"
                className="size-8 rounded-full text-xs"
                onClick={() => table.setPageIndex(i)}
              >
                {i + 1}
              </Button>
            ))
          ) : (
            <span className="px-2 text-xs text-muted-foreground">{pageIndex + 1} / {pageCount}</span>
          )}
          <Button
            variant="outline"
            size="icon"
            className="size-8 rounded-full"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
