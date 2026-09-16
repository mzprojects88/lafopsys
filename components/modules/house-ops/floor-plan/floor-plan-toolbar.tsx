"use client";

import { Pencil, Plus, Save, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FloorPlanToolbarProps {
  canEdit: boolean;
  editing: boolean;
  dirtyCount: number;
  saving: boolean;
  onToggleEdit: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onAddBed: () => void;
}

export function FloorPlanToolbar({ canEdit, editing, dirtyCount, saving, onToggleEdit, onSave, onDiscard, onAddBed }: FloorPlanToolbarProps) {
  if (!canEdit) return null;
  if (!editing) {
    return (
      <Button variant="outline" size="sm" onClick={onToggleEdit}>
        <Pencil className="size-3.5" /> Edit layout
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">
        Drag to move · R rotates · arrows nudge · Delete retires
      </span>
      <Button variant="outline" size="sm" onClick={onAddBed} disabled={saving}>
        <Plus className="size-3.5" /> Add bed
      </Button>
      <Button variant="outline" size="sm" onClick={onDiscard} disabled={saving || dirtyCount === 0}>
        <Undo2 className="size-3.5" /> Discard
      </Button>
      <Button size="sm" onClick={onSave} disabled={saving || dirtyCount === 0}>
        <Save className="size-3.5" /> {saving ? "Saving…" : `Save layout${dirtyCount ? ` (${dirtyCount})` : ""}`}
      </Button>
      <Button variant="ghost" size="sm" onClick={onToggleEdit} disabled={saving}>
        <X className="size-3.5" /> Done
      </Button>
    </div>
  );
}
