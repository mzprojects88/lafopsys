"use client";

import * as React from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";

/**
 * A temporary bed for an overflow night (0092): a mattress in a room, at most 2 per room and
 * 1 below Room 3, placed on the room's next preset spot. For anyone who assigns beds; it stays
 * until someone removes it from the bed's panel on the Floor Plan.
 */
export function AddTemporaryBedDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { rooms, units, addTemporaryBed } = useHouseLayout();
  const [roomId, setRoomId] = React.useState<string>("");
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const ordered = [...rooms].sort((a, b) => a.sortOrder - b.sortOrder);
  const used = (id: string) => units.filter((u) => u.active && u.temporary && u.roomId === id).length;
  const firstOpen = ordered.find((r) => used(r.id) < r.maxTemporary);

  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the form each time the dialog opens
      setRoomId(firstOpen?.id ?? "");
      setReason("");
    }
    // The first open room is derived from the rooms and beds at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const room = ordered.find((r) => r.id === roomId);
  const full = !!room && used(room.id) >= room.maxTemporary;
  const valid = !!room && !full && reason.trim().length >= 3;

  async function handleConfirm() {
    if (!valid) return;
    setSubmitting(true);
    const result = await addTemporaryBed(roomId, reason.trim());
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Temporary bed added in ${room!.name}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a temporary bed</DialogTitle>
          <DialogDescription>
            A mattress for an overflow night: up to 2 per room and 1 below Room 3. It is used only when the regular beds are full, and it stays until
            someone removes it from the Floor Plan.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="temp-bed-room">Room</FieldLabel>
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger id="temp-bed-room" className="w-full">
              <SelectValue placeholder="Choose a room" />
            </SelectTrigger>
            <SelectContent>
              {ordered.map((r) => (
                <SelectItem key={r.id} value={r.id} disabled={used(r.id) >= r.maxTemporary}>
                  {r.name} · {used(r.id)} of {r.maxTemporary} used
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {full && <FieldDescription>{room!.name} already has its temporary beds.</FieldDescription>}
        </Field>
        <Field>
          <FieldLabel htmlFor="temp-bed-reason">Why it is needed</FieldLabel>
          <Textarea id="temp-bed-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. NCH sent 15 families today" rows={2} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting || !valid}>
            {submitting ? "Adding…" : "Add temporary bed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
