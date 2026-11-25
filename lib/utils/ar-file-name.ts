/**
 * File names of donor documents (owner, 25 Nov 2026): "<Donor>-<number>.pdf", for example
 * "Juan Dela Cruz-LAF-GIK-2026-0049.pdf". The server that prints the document names it (it already
 * looks the donor up); the browser takes the name from the reply, so the two can't disagree.
 * Kept identical in ArkOS and LAF Inventory (lib/utils/ar-file-name.ts).
 */

/** Donor part cut here, on a whole word: 11 donor names are longer than 40 characters, the longest 96. */
const MAX_DONOR = 60;

export function arFileName(donorName: string | null | undefined, number: string): string {
  let donor = String(donorName ?? "")
    .normalize("NFC")
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]+/g, " ") // characters a file name can't hold on Windows, Mac or phones
    .replace(/\s+/g, " ")
    .trim();
  if (donor.length > MAX_DONOR) donor = donor.slice(0, MAX_DONOR).replace(/\s+\S*$/, "") || donor.slice(0, MAX_DONOR);
  const safeNumber = number.replace(/[^A-Za-z0-9-]+/g, "-");
  return `${donor || "Anonymous donor"}-${safeNumber}.pdf`;
}

/** The download header: a plain-letters name for old browsers, and the full name (ñ and all) for the rest. */
export function attachmentHeader(fileName: string): string {
  const plain = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** The name the server gave a download (filename* first), or `fallback` when the reply has none. */
export function fileNameFromHeader(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]!.trim());
    } catch {
      // a broken encoding: try the plain name
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}
