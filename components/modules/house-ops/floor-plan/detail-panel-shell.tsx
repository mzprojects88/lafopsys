"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

interface DetailPanelShellProps {
  /** Something is selected; the shell shows `children`, else `placeholder`. */
  open: boolean;
  title: string;
  kicker: string;
  placeholder: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * The slot beside the plan: an inline aside on desktop, a bottom sheet on
 * phones (where hover does not exist and the panel is the reading surface).
 * Beds and labels share it.
 */
export function DetailPanelShell({ open, title, kicker, placeholder, onClose, children }: DetailPanelShellProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        {/* Its own header row (as on desktop) so the close button never sits on the bed's status badge;
            side padding; and a height that leaves room for the phone browser's toolbar. */}
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[80dvh] gap-3 overflow-y-auto rounded-t-2xl px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>Details and actions</SheetDescription>
          </SheetHeader>
          <div className="mx-auto h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden />
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kicker}</span>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
          {open && children}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside className="flex flex-col gap-3 rounded-lg border p-4">
      {open ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kicker}</span>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
          {children}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{placeholder}</p>
      )}
    </aside>
  );
}
