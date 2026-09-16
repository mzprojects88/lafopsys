"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Room } from "@/lib/types/house-ops";

const UNPLACED = "__unplaced__";

interface AddBedDialogProps {
  open: boolean;
  suggestedCode: string;
  rooms: Room[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: { code: string; roomId: string | null }) => Promise<void>;
}

/** A new physical bed. It is created straight away (ops.create_bed), placed
 * in the middle of the chosen room, and can then be dragged like any other. */
export function AddBedDialog({ open, suggestedCode, rooms, onOpenChange, onConfirm }: AddBedDialogProps) {
  const [code, setCode] = React.useState(suggestedCode);
  const [roomId, setRoomId] = React.useState<string>(rooms[0]?.id ?? UNPLACED);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the form each time the dialog opens
      setCode(suggestedCode);
      setRoomId(rooms[0]?.id ?? UNPLACED);
    }
  }, [open, suggestedCode, rooms]);

  const valid = /^B[0-9]{1,3}$/.test(code.trim().toUpperCase());

  async function handleConfirm() {
    if (!valid) return;
    setSubmitting(true);
    await onConfirm({ code: code.trim().toUpperCase(), roomId: roomId === UNPLACED ? null : roomId });
    setSubmitting(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a bed</DialogTitle>
          <DialogDescription>The bed is created now and appears in the middle of the room, ready to drag into place.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="bed-code">Bed code</FieldLabel>
          <Input id="bed-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="B14" autoFocus />
          {!valid && code && <FieldDescription>A code looks like B14.</FieldDescription>}
        </Field>
        <Field>
          <FieldLabel htmlFor="bed-room">Room</FieldLabel>
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger id="bed-room" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rooms.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
              <SelectItem value={UNPLACED}>Unplaced (put it on the plan later)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting || !valid}>
            {submitting ? "Adding…" : "Add bed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
