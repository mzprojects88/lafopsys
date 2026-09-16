"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface AddLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (text: string) => void;
}

/** A new caption on the plan. It is a draft until Save layout. */
export function AddLabelDialog({ open, onOpenChange, onConfirm }: AddLabelDialogProps) {
  const [text, setText] = React.useState("");

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the field each time the dialog opens
    if (open) setText("");
  }, [open]);

  const valid = text.trim().length >= 1 && text.trim().length <= 60;

  function handleConfirm() {
    if (!valid) return;
    onConfirm(text.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a label</DialogTitle>
          <DialogDescription>It appears in the first room, ready to drag where it belongs. Saved with the layout.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="label-text">Text</FieldLabel>
          <Input
            id="label-text"
            value={text}
            maxLength={60}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
            }}
            placeholder="e.g. Nurse station"
            autoFocus
          />
          <FieldDescription>Up to 60 characters.</FieldDescription>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!valid}>
            Add label
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
