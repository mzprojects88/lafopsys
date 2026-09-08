"use client";

import * as React from "react";
import { toast } from "sonner";
import { ExternalLink, FileText, FolderOpen, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { deleteFile, fileOpenUrl } from "@/app/(app)/files/actions";
import { uploadFileToRecord } from "@/lib/files/upload-client";
import { filesFamily, filesKey, useRecordFiles } from "@/lib/hooks/use-files-collection";
import { ACCEPTED_FILE_TYPES, formatBytes, MODULE_OF_RECORD, type FileRecordType } from "@/lib/utils/file-paths";
import { formatDate } from "@/lib/utils/date";
import type { StoredFile } from "@/lib/types/files";

const ACCEPT = Object.keys(ACCEPTED_FILE_TYPES)
  .map((e) => `.${e}`)
  .join(",");

interface QueueItem {
  name: string;
  size: number;
  progress: number;
  state: "uploading" | "done" | "failed";
  error?: string;
}

/** Opens a signed link without tripping the popup blocker: the tab opens on the click, the address arrives after. */
export async function openStoredFile(id: string) {
  const win = window.open("", "_blank");
  const r = await fileOpenUrl(id);
  if (!r.ok) {
    win?.close();
    toast.error(r.error);
    return;
  }
  if (win) win.location.href = r.data!.url;
  else window.location.href = r.data!.url;
}

/**
 * The files hanging on one record: list, open, upload, remove. Which
 * buttons show is the module's rule (canUpload / canDelete); the server
 * and RLS enforce the same rule regardless. Uploads go straight from the
 * browser to the bucket with a signed URL, one file at a time, and are
 * confirmed by the server before they are listed.
 */
export function FileLibrary({
  recordType,
  recordId,
  subKey = null,
  subKeyOptions,
  subKeyLabel = "Type",
  canUpload,
  canDelete,
  title = "Files",
  description,
  compact = false,
}: {
  recordType: FileRecordType;
  recordId: string;
  /** Fixed sub-key (a compliance period); or let the uploader pick from subKeyOptions. */
  subKey?: string | null;
  subKeyOptions?: { value: string; label: string }[];
  subKeyLabel?: string;
  canUpload: boolean;
  canDelete: boolean;
  title?: string;
  description?: string;
  /** No card chrome: for use inside a dialog. */
  compact?: boolean;
}) {
  const fileModule = MODULE_OF_RECORD[recordType];
  const { files, loading } = useRecordFiles(fileModule, recordType, recordId);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const [chosenSubKey, setChosenSubKey] = React.useState<string>(subKeyOptions?.[0]?.value ?? "");
  const [confirmDelete, setConfirmDelete] = React.useState<StoredFile | null>(null);
  const [busy, setBusy] = React.useState(false);
  const ready = files.filter((f) => f.status === "ready");
  const labelFor = (key: string | null) => (key ? (subKeyOptions?.find((o) => o.value === key)?.label ?? key) : null);

  async function uploadAll(list: FileList) {
    const items = Array.from(list);
    setQueue(items.map((f) => ({ name: f.name, size: f.size, progress: 0, state: "uploading" })));
    const update = (i: number, patch: Partial<QueueItem>) => setQueue((q) => q.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    for (let i = 0; i < items.length; i++) {
      const r = await uploadFileToRecord(recordType, recordId, items[i], { subKey: subKey ?? (chosenSubKey || null), onProgress: (pct) => update(i, { progress: pct }) });
      if (r.ok) update(i, { state: "done", progress: 100 });
      else update(i, { state: "failed", error: r.error });
    }
    await filesFamily.get(filesKey(fileModule, recordType, recordId)).refetch();
    setTimeout(() => setQueue((q) => q.filter((x) => x.state === "failed")), 1500);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    const r = await deleteFile(confirmDelete.id);
    setBusy(false);
    setConfirmDelete(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await filesFamily.get(filesKey(fileModule, recordType, recordId)).refetch();
    toast.success("File removed.");
  }

  const body = (
    <>
      {canUpload ? (
        <div className="flex flex-wrap items-center gap-2">
          {subKeyOptions && subKeyOptions.length > 0 && !subKey ? (
            <Select value={chosenSubKey} onValueChange={setChosenSubKey}>
              <SelectTrigger className="w-56" aria-label={subKeyLabel}>
                <SelectValue placeholder={subKeyLabel} />
              </SelectTrigger>
              <SelectContent>
                {subKeyOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) void uploadAll(e.target.files);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => inputRef.current?.click()} disabled={queue.some((q) => q.state === "uploading")}>
            <Upload className="size-3.5" />
            Upload
          </Button>
          <span className="text-xs text-muted-foreground">PDF, images, Word, Excel, CSV · up to 50 MB each</span>
        </div>
      ) : null}

      {queue.map((q, i) => (
        <div key={`${q.name}-${i}`} className="flex flex-col gap-1 rounded-xl border px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{q.name}</span>
            <span className={q.state === "failed" ? "text-rose-700" : "text-muted-foreground"}>{q.state === "failed" ? q.error : q.state === "done" ? "Uploaded" : `${q.progress}%`}</span>
          </div>
          {q.state === "uploading" ? <Progress value={q.progress} /> : null}
        </div>
      ))}

      {loading && ready.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : ready.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        ready.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
            <button type="button" className="flex min-w-0 items-center gap-2 text-left hover:underline" onClick={() => void openStoredFile(f.id)}>
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{f.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  {labelFor(f.subKey) ? `${labelFor(f.subKey)} · ` : ""}
                  {formatBytes(f.sizeBytes)} · {formatDate(f.createdAt, "MMM d, yyyy")}
                </span>
              </span>
            </button>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-label="Open" onClick={() => void openStoredFile(f.id)}>
                <ExternalLink className="size-3.5" />
              </Button>
              {canDelete ? (
                <Button size="sm" variant="ghost" aria-label="Remove" className="text-rose-700" onClick={() => setConfirmDelete(f)}>
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </div>
        ))
      )}

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => (o ? undefined : setConfirmDelete(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this file?</AlertDialogTitle>
            <AlertDialogDescription>&ldquo;{confirmDelete?.fileName}&rdquo; is deleted from the bucket as well. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (compact) return <div className="flex flex-col gap-2">{body}</div>;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="size-4 text-muted-foreground" />
            {title}
            {ready.length > 0 ? <span className="text-xs font-normal text-muted-foreground">({ready.length})</span> : null}
          </CardTitle>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{body}</CardContent>
    </Card>
  );
}

