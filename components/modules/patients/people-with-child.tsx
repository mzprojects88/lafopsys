"use client";

import * as React from "react";
import { toast } from "sonner";
import { Minus, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * People with the child tonight (0112): carers and companions in the house with this family. The
 * social worker sets it on the admission board; a night and each meal tick then count 1 + this
 * many people in the Programs report. Copied to the next night by the daily reset.
 */
export function PeopleWithChild({ value, name, canEdit, onChange }: { value: number; name: string; canEdit: boolean; onChange: (next: number) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const [busy, setBusy] = React.useState(false);
  async function set(next: number) {
    if (next < 0 || next > 6) return;
    setBusy(true);
    const r = await onChange(next);
    setBusy(false);
    if (!r.ok) toast.error(r.error);
  }
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-theme-xs text-muted-foreground" title={`People with ${name} tonight: child + ${value}`}>
      <Users className="size-3.5" />
      {canEdit ? (
        <Button type="button" size="icon-sm" variant="ghost" className="size-6" disabled={busy || value <= 0} aria-label={`One fewer person with ${name}`} onClick={() => void set(value - 1)}>
          <Minus className="size-3" />
        </Button>
      ) : null}
      <span className="tabular-nums text-foreground">{1 + value}</span>
      {canEdit ? (
        <Button type="button" size="icon-sm" variant="ghost" className="size-6" disabled={busy || value >= 6} aria-label={`One more person with ${name}`} onClick={() => void set(value + 1)}>
          <Plus className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}
