"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Check, ClipboardList, FilePlus2, Home, RotateCcw, Search, Sparkles, UserCheck, UserX, Users, X } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { HouseSheetStatus } from "@/components/modules/patients/house-sheet-status";
import { confirmHouseSheetMatch, dismissHouseSheetRow, reopenHouseSheetRow } from "@/app/(app)/patients/house-sheet/actions";
import { houseSheetPeopleStore, useHouseSheetPeople, useHouseSheetRuns } from "@/lib/hooks/use-house-sheet-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useRole } from "@/lib/rbac/use-role";
import { canReviewHouseSheet } from "@/lib/rbac/roles";
import { formatDate } from "@/lib/utils/date";
import { HOUSE_SHEET_STATUS_LABELS, houseSheetPatientId, type HouseSheetPerson } from "@/lib/types/house-sheet";
import type { Patient } from "@/lib/types/patient";

/**
 * The house's Occupancy Tracker as the app sees it: every name on the
 * sheet, who it is in the system, and what is left to decide. Names the
 * deterministic pass settled are Matched; the model's picks are Suggested
 * until a person confirms; names it could not place are Not found, with a
 * one-click path to encode them as a referral.
 */
export default function HouseSheetPage() {
  const router = useRouter();
  const { role } = useRole();
  const canReview = canReviewHouseSheet(role);
  const { people, loading, error } = useHouseSheetPeople();
  const { runs } = useHouseSheetRuns();
  const { patients } = usePatientsData();
  const [showOff, setShowOff] = React.useState(false);
  const [picker, setPicker] = React.useState<HouseSheetPerson | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const patientById = React.useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const onSheet = React.useMemo(() => people.filter((p) => p.offSheetAt === null), [people]);
  const shown = showOff ? people : onSheet;
  const toReview = onSheet.filter((p) => p.matchStatus === "suggested").length;
  const toEncode = onSheet.filter((p) => p.matchStatus === "unmatched").length;
  const matched = onSheet.filter((p) => houseSheetPatientId(p) !== null && p.matchStatus !== "dismissed").length;
  const latestTab = runs.find((r) => r.tabDate && r.status !== "failed")?.tabDate ?? null;

  async function act(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(id);
    const r = await fn();
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error ?? "That did not work.");
      return;
    }
    await houseSheetPeopleStore.refetch();
    toast.success(done);
  }

  const patientCell = (p: HouseSheetPerson) => {
    const id = houseSheetPatientId(p);
    const patient = id ? patientById.get(id) : undefined;
    if (p.matchStatus === "dismissed") return <span className="text-muted-foreground">Not a patient</span>;
    if (p.matchStatus === "encoded" && !patient) return <span className="text-muted-foreground">Referral pending admission</span>;
    if (patient) {
      return (
        <span className="flex flex-col leading-tight">
          <Link href={`/patients/${patient.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {patient.lastName}, {patient.firstName}
          </Link>
          <span className="text-[11px] text-muted-foreground">
            #{patient.patientNumber}
            {p.matchStatus === "suggested" ? ` · AI suggests${p.matchConfidence !== null ? ` · ${Math.round(p.matchConfidence * 100)}%` : ""}` : p.matchMethod === "loose" ? " · matched on first name" : ""}
          </span>
        </span>
      );
    }
    if (id) return <span className="text-muted-foreground">Patient not visible</span>;
    return (
      <span className="flex flex-col leading-tight">
        <span className="text-muted-foreground">Not in the system</span>
        {p.aiCandidates.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            Similar: {p.aiCandidates.slice(0, 3).map((c) => `${c.name} (#${c.patientNumber})`).join(", ")}
          </span>
        ) : null}
      </span>
    );
  };

  const columns: ColumnDef<HouseSheetPerson>[] = [
    { id: "rowNo", header: "#", accessorFn: (p) => p.rowNo ?? "", cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.rowNo ?? "—"}</span> },
    {
      id: "sheetName",
      header: "On the sheet",
      accessorFn: (p) => p.patientName,
      cell: ({ row }) => (
        <span className="flex flex-col leading-tight">
          <span className="font-medium">{row.original.patientName}</span>
          <span className="text-[11px] text-muted-foreground">
            {row.original.daysSeen} day{row.original.daysSeen === 1 ? "" : "s"} · since {formatDate(row.original.firstSeenOn, "MMM d")}
            {row.original.offSheetAt ? ` · left ${formatDate(row.original.lastSeenOn, "MMM d")}` : ""}
          </span>
        </span>
      ),
    },
    { id: "patient", header: "In the system", accessorFn: (p) => houseSheetPatientId(p) ?? "", cell: ({ row }) => patientCell(row.original) },
    {
      id: "status",
      header: "Status",
      accessorFn: (p) => p.matchStatus,
      cell: ({ row }) => {
        const p = row.original;
        const badge = <StatusBadge domain="houseSheet" status={p.matchStatus} label={HOUSE_SHEET_STATUS_LABELS[p.matchStatus]} />;
        if (!p.aiReason && !p.aiError) return badge;
        return (
          <HoverCard openDelay={150}>
            <HoverCardTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-1">
                {badge}
                <Sparkles className="size-3 text-muted-foreground" />
              </span>
            </HoverCardTrigger>
            <HoverCardContent className="w-72 text-xs">
              {p.aiReason ? <p>{p.aiReason}</p> : null}
              {p.aiError ? <p className="text-rose-700">Model: {p.aiError}</p> : null}
            </HoverCardContent>
          </HoverCard>
        );
      },
    },
    {
      id: "carer",
      header: "Carer",
      accessorFn: (p) => [p.carerName, p.relationship, p.phone].filter(Boolean).join(" "),
      cell: ({ row }) => (
        <span className="flex flex-col leading-tight">
          <span>{row.original.carerName ?? "—"}</span>
          <span className="text-[11px] text-muted-foreground">{[row.original.relationship, row.original.phone].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    },
    {
      id: "appointment",
      header: "Next appointment",
      accessorFn: (p) => p.nextAppointmentOn ?? p.nextAppointmentRaw ?? "",
      cell: ({ row }) =>
        row.original.nextAppointmentRaw ? (
          <span className="flex flex-col leading-tight">
            <span>{row.original.nextAppointmentOn ? formatDate(row.original.nextAppointmentOn, "EEE, MMM d") : row.original.nextAppointmentRaw}</span>
            {row.original.nextAppointmentOn ? <span className="text-[11px] text-muted-foreground">{row.original.nextAppointmentRaw}</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: "treatment", header: "Treatment", accessorFn: (p) => p.treatment ?? "", cell: ({ row }) => row.original.treatment ?? <span className="text-muted-foreground">—</span> },
    { id: "address", header: "Address", accessorFn: (p) => p.address ?? "", cell: ({ row }) => row.original.address ?? <span className="text-muted-foreground">—</span> },
    { id: "laf", header: "LAF", accessorFn: (p) => (p.lafFlag ? "LAF" : ""), cell: ({ row }) => (row.original.lafFlag ? <StatusBadge domain="venue" status="laf" label="LAF" /> : <span className="text-muted-foreground">—</span>) },
    ...(canReview
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }) => {
              const p = row.original;
              const b = busy === p.id;
              const encodeHref = `/patients/referrals/new?fromSheet=${p.id}`;
              return (
                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  {p.matchStatus === "suggested" && p.matchedPatientId ? (
                    <Button size="sm" variant="outline" className="h-7 gap-1" disabled={b} onClick={() => act(p.id, () => confirmHouseSheetMatch(p.id, p.matchedPatientId!), "Confirmed.")}>
                      <Check className="size-3.5" /> Confirm
                    </Button>
                  ) : null}
                  {["suggested", "unmatched", "auto_matched"].includes(p.matchStatus) ? (
                    <Button size="sm" variant="ghost" className="h-7 gap-1" disabled={b} onClick={() => setPicker(p)} aria-label="Choose patient">
                      <Search className="size-3.5" /> {p.matchStatus === "auto_matched" ? "Change" : "Choose…"}
                    </Button>
                  ) : null}
                  {p.matchStatus === "unmatched" || p.matchStatus === "suggested" ? (
                    <Button size="sm" variant="ghost" className="h-7 gap-1" disabled={b} onClick={() => router.push(encodeHref)}>
                      <FilePlus2 className="size-3.5" /> Encode
                    </Button>
                  ) : null}
                  {p.matchStatus !== "dismissed" && p.matchStatus !== "encoded" ? (
                    <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" disabled={b} aria-label="Not a patient" onClick={() => act(p.id, () => dismissHouseSheetRow(p.id), "Dismissed.")}>
                      <X className="size-3.5" />
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-muted-foreground" disabled={b} onClick={() => act(p.id, () => reopenHouseSheetRow(p.id), "Reopened.")}>
                      <RotateCcw className="size-3.5" /> Reopen
                    </Button>
                  )}
                </div>
              );
            },
          } satisfies ColumnDef<HouseSheetPerson>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="House sheet"
        description={`Who the Occupancy Tracker says is in the house${latestTab ? ` as of ${formatDate(latestTab, "EEEE, MMM d")}` : ""}, and who each name is in the system.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/patients">
              <Users className="size-4" />
              All patients
            </Link>
          </Button>
        }
      />

      <HouseSheetStatus canRun={canReview} />

      <KpiGrid>
        <KpiCard label="In the house" value={loading ? "…" : onSheet.length} icon={Home} color="blue" sublabel={latestTab ? `tab ${formatDate(latestTab, "MMM d")}` : undefined} />
        <KpiCard label="Matched" value={loading ? "…" : matched} icon={UserCheck} color="green" />
        <KpiCard label="To confirm" value={loading ? "…" : toReview} icon={Sparkles} color="indigo" sublabel="AI suggestions" />
        <KpiCard label="Not in the system" value={loading ? "…" : toEncode} icon={UserX} color="amber" sublabel="encode as referral" />
      </KpiGrid>

      {error ? (
        <EmptyState title="Couldn't load the house sheet" description={error} />
      ) : (
        <DataTable
          columns={columns}
          data={shown}
          searchPlaceholder="Search names, carers, addresses…"
          pageSize={25}
          emptyMessage={loading ? "Loading…" : "Nothing read from the sheet yet. Use Check now."}
          toolbar={
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showOff} onCheckedChange={setShowOff} aria-label="Show people who left" />
              Show people who left
            </label>
          }
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="size-4 text-muted-foreground" />
            Checks
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
          {runs.length === 0 ? <p>No checks yet.</p> : null}
          {runs.slice(0, 8).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-2">
              <span className="tabular-nums">{formatDate(r.startedAt, "MMM d, HH:mm")}</span>
              <StatusBadge domain="calendarSync" status={r.status} label={r.status} />
              <span>{r.tabDate ? `tab ${formatDate(r.tabDate, "MMM d")}` : ""}</span>
              {r.status === "success" ? (
                <span>
                  {r.rowsSeen} on the sheet · {r.inserted} new · {r.autoMatched} matched · {r.suggested} suggested · {r.unmatched} not found
                  {r.aiCalls ? ` · ${r.aiCalls} model call${r.aiCalls === 1 ? "" : "s"}` : ""}
                </span>
              ) : null}
              {r.error ? <span className="text-rose-700">{r.error.split("\n")[0]}</span> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <PatientPicker
        person={picker}
        patients={patients}
        onClose={() => setPicker(null)}
        onPick={(patient) => {
          const p = picker!;
          setPicker(null);
          void act(p.id, () => confirmHouseSheetMatch(p.id, patient.id), `Linked to ${patient.lastName}, ${patient.firstName}.`);
        }}
      />
    </div>
  );
}

function PatientPicker({ person, patients, onClose, onPick }: { person: HouseSheetPerson | null; patients: Patient[]; onClose: () => void; onPick: (p: Patient) => void }) {
  const candidates = person ? new Set(person.aiCandidates.map((c) => c.id)) : new Set<string>();
  const sorted = React.useMemo(() => [...patients].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)), [patients]);
  return (
    <Dialog open={person !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Who is &ldquo;{person?.patientName}&rdquo;?</DialogTitle>
          <DialogDescription>Pick the patient record this name on the sheet stands for.</DialogDescription>
        </DialogHeader>
        <Command className="rounded-b-lg border-t">
          <CommandInput placeholder="Type a name or patient number…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No patient by that name.</CommandEmpty>
            {candidates.size > 0 ? (
              <CommandGroup heading="Similar names">
                {sorted
                  .filter((p) => candidates.has(p.id))
                  .map((p) => (
                    <CommandItem key={`c-${p.id}`} value={`${p.lastName} ${p.firstName} ${p.patientNumber}`} onSelect={() => onPick(p)}>
                      {p.lastName}, {p.firstName} <span className="ml-auto text-xs text-muted-foreground">#{p.patientNumber}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading="All patients">
              {sorted.map((p) => (
                <CommandItem key={p.id} value={`${p.lastName} ${p.firstName} ${p.patientNumber}`} onSelect={() => onPick(p)}>
                  {p.lastName}, {p.firstName} <span className="ml-auto text-xs text-muted-foreground">#{p.patientNumber}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
