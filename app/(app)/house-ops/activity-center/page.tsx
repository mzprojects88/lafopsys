"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActivitySessionsData } from "@/lib/hooks/use-activity-sessions-collection";
import type { ActivitySession } from "@/lib/types/house-ops";
import { formatDate, todayIso } from "@/lib/utils/date";
import { useModuleAccess } from "@/lib/hooks/use-module-access";

const columns: ColumnDef<ActivitySession>[] = [
  { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
  {
    accessorKey: "title",
    header: "Session",
    cell: ({ row }) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {row.original.title}
        {row.original.source === "sheet" ? <Badge variant="outline">LAF Programs sheet</Badge> : null}
      </span>
    ),
  },
  { accessorKey: "site", header: "Site", cell: ({ row }) => (row.original.site === "LAF" ? "LAF House" : "NCH") },
  { accessorKey: "participants", header: "Participants" },
  { accessorKey: "volunteerCount", header: "Volunteers" },
  { accessorKey: "facilitator", header: "Facilitator" },
  { accessorKey: "hours", header: "Hours" },
];

export default function ActivityCenterPage() {
  const { sessions, addSession } = useActivitySessionsData();
  const editable = useModuleAccess().canEdit("house_ops");
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [participants, setParticipants] = React.useState("");
  const [volunteerCount, setVolunteerCount] = React.useState("");
  const [facilitator, setFacilitator] = React.useState("");
  const [hours, setHours] = React.useState("");
  const [site, setSite] = React.useState<"NCH" | "LAF">("NCH");
  const [submitting, setSubmitting] = React.useState(false);

  function reset() {
    setTitle("");
    setParticipants("");
    setVolunteerCount("");
    setFacilitator("");
    setHours("");
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setSubmitting(true);
    const result = await addSession({
      date: todayIso(),
      title: title.trim(),
      participants: Number(participants) || 0,
      volunteerCount: Number(volunteerCount) || 0,
      facilitator: facilitator.trim(),
      hours: Number(hours) || 0,
      site,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't log the session: ${result.error}`);
      return;
    }
    toast.success("Session logged");
    reset();
    setOpen(false);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Activity Center"
        description="Session log for the LAF Center @ NCH and activities at LAF House: participants, hours, volunteers, facilitator."
        action={
          editable && <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus />Log Session</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Log Activity Session</DialogTitle>
                <DialogDescription>Record today&apos;s session details.</DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="title">Session Title</FieldLabel>
                  <Input id="title" placeholder="e.g. Art & Craft" value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="site">Where</FieldLabel>
                  <Select value={site} onValueChange={(v) => setSite(v as "NCH" | "LAF")}>
                    <SelectTrigger id="site" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NCH">LAF Center @ NCH</SelectItem>
                      <SelectItem value="LAF">Activities @ LAF House</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="participants">Participants</FieldLabel>
                    <Input id="participants" type="number" min="0" value={participants} onChange={(e) => setParticipants(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="volunteerCount">Volunteers</FieldLabel>
                    <Input id="volunteerCount" type="number" min="0" value={volunteerCount} onChange={(e) => setVolunteerCount(e.target.value)} />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="facilitator">Facilitator</FieldLabel>
                  <Input id="facilitator" value={facilitator} onChange={(e) => setFacilitator(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="hours">Hours</FieldLabel>
                  <Input id="hours" type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={!title.trim() || submitting} onClick={handleCreate}>
                  {submitting ? "Logging…" : "Log Session"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <DataTable columns={columns} data={sessions} searchPlaceholder="Search sessions…" />
    </div>
  );
}
