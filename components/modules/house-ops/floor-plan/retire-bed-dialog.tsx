"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { BedView } from "./bed-view";

interface RetireBedDialogProps {
  bed: BedView | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

/** Takes a bed off the plan for good. Its stay history stays on the patients' records. */
export function RetireBedDialog({ bed, onOpenChange, onConfirm }: RetireBedDialogProps) {
  const occupied = (bed?.occupants.length ?? 0) > 0;
  return (
    <AlertDialog open={!!bed} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retire bed {bed?.code}?</AlertDialogTitle>
          <AlertDialogDescription>
            {occupied
              ? "Someone is checked into this bed. Transfer or discharge them first; the database will refuse otherwise."
              : "It leaves the plan and every admission list. Past stays keep pointing at it, and adding a bed with the same code later brings it back."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={occupied} onClick={() => void onConfirm()}>
            Retire bed
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
