"use client";

import * as React from "react";
import { RotateCw, Tag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FloorPlanLabel } from "@/lib/types/house-ops";

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];

interface LabelDetailPanelProps {
  label: FloorPlanLabel;
  editing: boolean;
  dirty: boolean;
  onPatch: (label: FloorPlanLabel, patch: Partial<Omit<FloorPlanLabel, "id">>) => void;
  onRotate: (label: FloorPlanLabel, deltaDeg: number) => void;
  onDelete: (label: FloorPlanLabel) => void;
}

/** The selected label. Read mode shows the text; edit mode edits it. */
export function LabelDetailPanel({ label, editing, dirty, onPatch, onRotate, onDelete }: LabelDetailPanelProps) {
  const [text, setText] = React.useState(label.text);
  const [rotationText, setRotationText] = React.useState(String(label.rotationDeg));

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the label into the fields when it changes elsewhere (R key, drag)
    setText(label.text);
    setRotationText(String(label.rotationDeg));
  }, [label.id, label.text, label.rotationDeg]);

  function commitText() {
    const t = text.trim();
    if (t.length >= 1 && t.length <= 60 && t !== label.text) onPatch(label, { text: t });
    else setText(label.text);
  }

  function commitRotation() {
    const n = Number(rotationText);
    if (Number.isFinite(n)) onPatch(label, { rotationDeg: ((Math.round(n) % 360) + 360) % 360 });
    else setRotationText(String(label.rotationDeg));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <Tag className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col">
          <span className="text-base font-medium text-foreground">{label.text}</span>
          <span className="text-theme-xs text-muted-foreground">
            Label{dirty ? " · unsaved" : ""}
          </span>
        </div>
      </div>

      {editing && (
        <div className="flex flex-col gap-3 border-t pt-3">
          <Field>
            <FieldLabel htmlFor="label-edit-text">Text</FieldLabel>
            <Input
              id="label-edit-text"
              value={text}
              maxLength={60}
              onChange={(e) => setText(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitText();
              }}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor="label-rotation">Rotation (°)</FieldLabel>
              <Input
                id="label-rotation"
                inputMode="numeric"
                value={rotationText}
                onChange={(e) => setRotationText(e.target.value)}
                onBlur={commitRotation}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRotation();
                }}
              />
            </Field>
            <Button variant="outline" size="sm" onClick={() => onRotate(label, 90)} title="Rotate 90° (R)">
              <RotateCw className="size-3.5" /> 90°
            </Button>
          </div>
          <Field>
            <FieldLabel htmlFor="label-size">Font size</FieldLabel>
            <Select value={String(label.fontSize)} onValueChange={(v) => onPatch(label, { fontSize: Number(v) })}>
              <SelectTrigger id="label-size" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_SIZES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button variant="destructive" size="sm" onClick={() => onDelete(label)} className="self-start">
            <Trash2 className="size-3.5" /> Delete label
          </Button>
        </div>
      )}
    </div>
  );
}
