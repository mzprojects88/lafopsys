"use client";

import * as React from "react";
import { toast } from "sonner";
import { Camera, IdCard, Printer, RefreshCw, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { usePatientCards, idCardsPdfUrl } from "@/lib/hooks/use-patient-cards";
import { usePatientDocuments } from "@/lib/hooks/use-patient-documents";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { formatDate } from "@/lib/utils/date";
import { plainError } from "@/lib/utils/plain-error";
import type { Patient } from "@/lib/types/patient";

/** A phone photo cut to the card's photo shape (20 x 24 mm, 5:6) and made small: 500 x 600 JPEG. */
async function cardPhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const target = 5 / 6;
  const sw = Math.min(bitmap.width, bitmap.height * target);
  const sh = sw / target;
  const canvas = document.createElement("canvas");
  canvas.width = 500;
  canvas.height = 600;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, 500, 600);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("Couldn't read the photo.");
  return new File([blob], "id-photo.jpg", { type: "image/jpeg" });
}

/**
 * The child's Patient ID card (0164): photo consent and photo, the card itself, print, and a new card
 * when one is lost. Patients editors change it; everyone who sees the child sees which card is current.
 */
export function IdCardSection({ patient, canEdit }: { patient: Patient; canEdit: boolean }) {
  const { cards, activeCard, issue, switchOff } = usePatientCards();
  const { updatePatient } = usePatientsData();
  const { documents, uploadFile, getSignedUrl } = usePatientDocuments(patient.id);
  const [busy, setBusy] = React.useState(false);
  const [asking, setAsking] = React.useState<"replace" | "off" | null>(null);
  // The private link for the card photo, kept with the file it was made for.
  const [signed, setSigned] = React.useState<{ path: string; url: string | null } | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const card = activeCard(patient.id);
  const past = cards.filter((c) => c.patientId === patient.id && c.status !== "active");
  const consent = patient.photoConsentGranted === true;
  const photoPath = documents.find((d) => d.documentType === "patient_photo")?.storagePath;

  React.useEffect(() => {
    let live = true;
    if (consent && photoPath) void getSignedUrl(photoPath).then((url) => live && setSigned({ path: photoPath, url }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getSignedUrl is a new function each render.
  }, [consent, photoPath]);
  const photoUrl = consent && photoPath && signed?.path === photoPath ? signed.url : null;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) toast.error(plainError(r.error));
    else toast.success(done);
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadFile("patient_photo", await cardPhoto(file));
      if (!r.ok) toast.error(plainError(r.error));
      else toast.success("Photo saved for the card.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the photo.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const print = () => window.open(idCardsPdfUrl([patient.id]), "_blank", "noopener");

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-theme-sm font-semibold">
          <IdCard className="size-4 text-muted-foreground" />
          Patient ID card
        </span>
        <span className="text-theme-xs text-muted-foreground">
          {card ? `Card ${card.version} · issued ${formatDate(card.issuedAt)}` : "No card yet"}
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-24 w-20 items-center justify-center overflow-hidden rounded-xl bg-muted text-theme-xs text-muted-foreground">
          {photoUrl ? <img src={photoUrl} alt="The child's card photo" width={80} height={96} className="h-full w-full object-cover" /> : consent ? "No photo" : "Initials"}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label className="flex items-center justify-between gap-3 text-theme-sm">
            <span>
              Photo consent
              <span className="block text-theme-xs text-muted-foreground">
                {consent ? "The card shows the child's photo." : "Without consent the card shows the child's initials, and no photo is printed."}
              </span>
            </span>
            <Switch
              aria-label="Photo consent"
              checked={consent}
              disabled={!canEdit || busy}
              onCheckedChange={(on) => void run(() => updatePatient(patient.id, { photoConsentGranted: on }), on ? "Photo consent recorded." : "Photo consent withdrawn: cards show initials.")}
            />
          </label>
          {canEdit && consent ? (
            <>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png" capture="environment" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
              <Button size="sm" variant="outline" className="w-fit gap-1.5" disabled={busy} onClick={() => fileInput.current?.click()}>
                <Camera className="size-3.5" />
                {photoPath ? "Retake photo" : "Take photo"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {card ? (
          <>
            <Button size="sm" className="gap-1.5" onClick={print}>
              <Printer className="size-3.5" />
              Print card
            </Button>
            {canEdit ? (
              <>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => setAsking("replace")}>
                  <RefreshCw className="size-3.5" />
                  New card (lost or damaged)
                </Button>
                <Button size="sm" variant="ghost" className="gap-1.5" disabled={busy} onClick={() => setAsking("off")}>
                  <Power className="size-3.5" />
                  Switch off
                </Button>
              </>
            ) : null}
          </>
        ) : canEdit ? (
          <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => void run(() => issue(patient.id), "Card issued: print it now.")}>
            <IdCard className="size-3.5" />
            Issue card
          </Button>
        ) : null}
      </div>
      {past.length ? (
        <p className="text-theme-xs text-muted-foreground">
          Earlier cards no longer work: {past.map((c) => `card ${c.version} (${c.status === "replaced" ? "replaced" : "switched off"}${c.endedReason ? `: ${c.endedReason}` : ""})`).join("; ")}.
        </p>
      ) : null}

      <ReasonDialog
        open={asking === "replace"}
        onOpenChange={(open) => !open && setAsking(null)}
        title="Print a new card"
        description="The current card stops working at once; the new one gets a new code. Why is a new card needed?"
        confirmLabel="Issue new card"
        onConfirm={(reason) => void run(() => issue(patient.id, reason), "New card issued: print it now. The old card no longer works.")}
      />
      <ReasonDialog
        open={asking === "off"}
        onOpenChange={(open) => !open && setAsking(null)}
        title="Switch the card off"
        description="The card stops working at once and no new card is printed. Why?"
        confirmLabel="Switch off"
        destructive
        onConfirm={(reason) => void run(() => (card ? switchOff(card.id, reason) : Promise.resolve({ ok: true })), "Card switched off.")}
      />
    </div>
  );
}
