"use client";

import { abandonUpload, confirmUpload, createUploadIntent } from "@/app/(app)/files/actions";
import { contentTypeFor, MAX_FILE_BYTES, type FileRecordType } from "@/lib/utils/file-paths";

/** PUT one file to its signed URL, reporting progress. */
function putWithProgress(url: string, file: File, contentType: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The bucket refused the upload (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("The upload did not reach the bucket. Check the connection and try again."));
    xhr.send(file);
  });
}

/**
 * The whole browser side of one upload: ask the server for a row and a
 * signed URL, PUT the bytes straight to the bucket, have the server confirm.
 * Any failure after the row exists abandons it, so nothing half-done is
 * ever listed.
 */
export async function uploadFileToRecord(recordType: FileRecordType, recordId: string, file: File, opts: { subKey?: string | null; onProgress?: (pct: number) => void } = {}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!contentTypeFor(file.name)) return { ok: false, error: "That file type is not accepted." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "Over 50 MB." };
  if (file.size <= 0) return { ok: false, error: "The file is empty." };
  const intent = await createUploadIntent({ recordType, recordId, subKey: opts.subKey ?? null, fileName: file.name, sizeBytes: file.size });
  if (!intent.ok) return intent;
  const { id, url, contentType } = intent.data!;
  try {
    await putWithProgress(url, file, contentType, opts.onProgress);
    const confirmed = await confirmUpload(id);
    if (!confirmed.ok) throw new Error(confirmed.error);
    return { ok: true, id };
  } catch (e) {
    await abandonUpload(id);
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}
