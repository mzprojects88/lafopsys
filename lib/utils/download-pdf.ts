import { fileNameFromHeader } from "@/lib/utils/ar-file-name";

/** Fetches a PDF the server builds on demand and hands it to the browser as a download, as `filename`.
 * `serverName`: use the name the server gives instead (donor documents, "<Donor>-<number>.pdf", 25 Nov 2026);
 * `filename` is then only the fallback. */
export async function downloadPdf(url: string, body: Record<string, unknown>, filename: string, serverName = false): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: j?.error ?? `Download failed (${res.status})` };
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = serverName ? fileNameFromHeader(res.headers.get("content-disposition"), filename) : filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  return { ok: true };
}
