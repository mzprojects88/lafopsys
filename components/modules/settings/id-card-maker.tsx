"use client";

import * as React from "react";
import { toast } from "sonner";
import { Download, ExternalLink, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { updateIdCardTemplate } from "@/app/(app)/settings/actions";
import { CARD_TEXT_LIMITS as L, CARD_THEMES, DEFAULT_CARD_TEMPLATE, normalizeCardTemplate, type CardTemplate, type CardThemeKey } from "@/lib/utils/id-card-template";

const hex = (c: [number, number, number]) => `rgb(${c.join(",")})`;

/**
 * The Patient ID Maker (0169, owner 21 Nov 2026): one design for every child's card, set here by the Super
 * Admin. The preview is the real printer's PDF with made-up children, so it is exactly what prints.
 */
export function IdCardMaker() {
  const { idCardTemplate, loading, refetch } = useAppSettings();
  const saved = React.useMemo(() => normalizeCardTemplate(idCardTemplate), [idCardTemplate]);
  const [draft, setDraft] = React.useState<CardTemplate | null>(null);
  const t = draft ?? saved;
  // What will print: the draft as typed, cleaned (spaces trimmed, limits kept) only for the preview and the save.
  const clean = React.useMemo(() => normalizeCardTemplate(t), [t]);
  const dirty = draft !== null && JSON.stringify(clean) !== JSON.stringify(saved);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const set = (patch: (d: CardTemplate) => CardTemplate) => setDraft((d) => patch(structuredClone(d ?? saved)));

  // The preview follows the form, a moment after the last change.
  const key = JSON.stringify(clean);
  React.useEffect(() => {
    if (loading) return;
    let url: string | null = null;
    const timer = setTimeout(async () => {
      const res = await fetch("/api/patients/id-cards/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template: JSON.parse(key) }) });
      if (!res.ok) return;
      url = URL.createObjectURL(await res.blob());
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [key, loading]);

  async function save(value: CardTemplate | null) {
    setSaving(true);
    const r = await updateIdCardTemplate(value);
    setSaving(false);
    if (!r.ok) return void toast.error(r.error ?? "Couldn't save.");
    toast.success(value ? "Saved: every card printed from now on uses this design." : "Back to the LAF design.");
    setDraft(null);
    await refetch();
  }

  async function testSheet() {
    const res = await fetch("/api/patients/id-cards/preview?download=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template: clean }) });
    if (!res.ok) return void toast.error("Couldn't make the test sheet.");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await res.blob());
    a.download = "LAF-ID-card-test-sheet.pdf";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const text = (label: string, value: string, max: number, onChange: (v: string) => void, hint?: string) => (
    <label className="flex flex-col gap-1 text-theme-sm">
      <span className="flex justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="text-theme-xs text-muted-foreground">
          {value.length}/{max}
        </span>
      </span>
      <Input value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="text-theme-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
  const para = (label: string, value: string, max: number, onChange: (v: string) => void) => (
    <label className="flex flex-col gap-1 text-theme-sm">
      <span className="flex justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="text-theme-xs text-muted-foreground">
          {value.length}/{max}
        </span>
      </span>
      <Textarea value={value} maxLength={max} rows={2} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
  const toggle = (label: string, on: boolean, onChange: (v: boolean) => void) => (
    <label className="flex min-h-10 items-center justify-between gap-3 text-theme-sm">
      {label}
      <Switch checked={on} onCheckedChange={onChange} aria-label={label} />
    </label>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <p className="text-theme-xs text-muted-foreground">
          One design for every child&apos;s card: on the child&apos;s page, the House Sheet and Patients › ID cards. The size, the QR code, the logo and &quot;a photo only with photo consent&quot; never change, and cards already printed keep working.
        </p>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-theme-sm font-semibold">Look</legend>
          <span className="text-theme-xs text-muted-foreground">LAF Storybook: the watercolour sky, rainbow, ribbon and waves, with an illustrated child when there is no photo consent. The plain looks are flat LAF colours.</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Card look">
            {(Object.keys(CARD_THEMES) as CardThemeKey[]).map((k) => {
              const th = CARD_THEMES[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={t.theme === k}
                  onClick={() => set((d) => ({ ...d, theme: k }))}
                  className={cn("flex min-h-11 items-center gap-2 rounded-xl border px-3 text-left text-theme-sm", t.theme === k ? "border-primary ring-2 ring-primary/30" : "border-border hover:bg-muted")}
                >
                  <span className="flex overflow-hidden rounded-md border border-border">
                    {[th.main, th.band, th.accent, th.soft].map((c, i) => (
                      <span key={i} className="size-4" style={{ background: hex(c) }} />
                    ))}
                  </span>
                  {th.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-theme-sm font-semibold">Front</legend>
          {text("Title", t.title, L.title, (v) => set((d) => ({ ...d, title: v })), "The pill at the top right.")}
          {text("Under the QR code", t.qrCaption, L.qrCaption, (v) => set((d) => ({ ...d, qrCaption: v })), "Empty: no line.")}
          {t.theme === "storybook" ? text("Line under the LFCN", t.scanLine, L.scanLine, (v) => set((d) => ({ ...d, scanLine: v })), "Empty: no line.") : null}
          {toggle("LFCN (case number)", t.show.caseNumber, (v) => set((d) => ({ ...d, show: { ...d.show, caseNumber: v } })))}
          {toggle("Carer", t.show.carer, (v) => set((d) => ({ ...d, show: { ...d.show, carer: v } })))}
          {toggle("Card number and date issued", t.show.cardLine, (v) => set((d) => ({ ...d, show: { ...d.show, cardLine: v } })))}
          {toggle("Service marks", t.show.marks, (v) => set((d) => ({ ...d, show: { ...d.show, marks: v } })))}
          {t.show.marks ? (
            <div className="grid grid-cols-3 gap-2">
              {t.marks.map((m, i) => (
                <Input key={i} aria-label={`Mark ${i + 1}`} value={m} maxLength={L.mark} onChange={(e) => set((d) => ({ ...d, marks: d.marks.map((x, j) => (j === i ? e.target.value : x)) as CardTemplate["marks"] }))} />
              ))}
            </div>
          ) : null}
          {text("Footer, first line", t.footer[0], L.footer0, (v) => set((d) => ({ ...d, footer: [v, d.footer[1]] })))}
          {text("Footer, second line", t.footer[1], L.footer1, (v) => set((d) => ({ ...d, footer: [d.footer[0], v] })), "Empty: one line.")}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-theme-sm font-semibold">Back</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {text("Heading, line 1", t.back.heading[0], L.heading, (v) => set((d) => ({ ...d, back: { ...d.back, heading: [v, d.back.heading[1]] } })))}
            {text("Heading, line 2", t.back.heading[1], L.heading, (v) => set((d) => ({ ...d, back: { ...d.back, heading: [d.back.heading[0], v] } })))}
          </div>
          {para("What the card is for", t.back.intro, L.intro, (v) => set((d) => ({ ...d, back: { ...d.back, intro: v } })))}
          {para("Privacy box", t.back.privacy, L.privacy, (v) => set((d) => ({ ...d, back: { ...d.back, privacy: v } })))}
          {para("Lost or damaged", t.back.lost, L.lost, (v) => set((d) => ({ ...d, back: { ...d.back, lost: v } })))}
          {text("Found this card", t.back.found, L.found, (v) => set((d) => ({ ...d, back: { ...d.back, found: v } })), "The address from Receipts & certificates is added after it.")}
          <span className="text-theme-xs text-muted-foreground">An empty paragraph is left out; long texts print a little smaller so the back always fits.</span>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-theme-sm font-semibold">Printing</legend>
          {([
            ["fold", "Fold sheet", "Three cards a page, front and back side by side: cut, fold on the dashed line, laminate."],
            ["duplex", "Two-sided", "Nine fronts on one page, their backs on the next: print both sides (flip on the long edge), then cut."],
          ] as const).map(([k, label, what]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={t.layout === k}
              onClick={() => set((d) => ({ ...d, layout: k }))}
              className={cn("flex flex-col rounded-xl border px-3 py-2 text-left text-theme-sm", t.layout === k ? "border-primary ring-2 ring-primary/30" : "border-border hover:bg-muted")}
            >
              <span className="font-medium">{label}</span>
              <span className="text-theme-xs text-muted-foreground">{what}</span>
            </button>
          ))}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button disabled={saving || loading || !dirty} onClick={() => void save(clean)}>
            {saving ? "Saving…" : "Save design"}
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => setDraft(structuredClone(DEFAULT_CARD_TEMPLATE))}>
            <RotateCcw className="size-4" /> Reset to LAF design
          </Button>
          <Button variant="outline" onClick={() => void testSheet()}>
            <Download className="size-4" /> Download a test sheet
          </Button>
          {dirty ? <span className="self-center text-theme-xs text-warning-foreground dark:text-warning">Not saved yet</span> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 self-start lg:sticky lg:top-24">
        <div className="flex items-center justify-between gap-2">
          <span className="text-theme-sm font-semibold">Preview (made-up children)</span>
          {preview ? (
            <a href={preview} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-theme-xs text-primary hover:underline">
              <ExternalLink className="size-3.5" /> Open
            </a>
          ) : null}
        </div>
        <div className="aspect-[210/297] w-full overflow-hidden rounded-xl border border-border bg-muted">
          {preview ? <iframe title="Patient ID card preview" src={`${preview}#toolbar=0&view=FitH`} className="size-full" /> : <p className="p-4 text-theme-sm text-muted-foreground">Making the preview…</p>}
        </div>
      </div>
    </div>
  );
}
