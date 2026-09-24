/**
 * The DTR punch photo (0060): a live front-camera frame, shrunk on the phone
 * to a JPEG and sent with the punch as a data URL. Pure, so
 * tests/punch-photo.test.mjs runs it under node --test.
 */

/** Longest side of the stored photo: enough to recognise a face, small enough to send on a weak signal. */
export const PHOTO_MAX_SIDE = 640;
export const PHOTO_QUALITY = 0.7;
/** Far above a 640px JPEG (~40-90 KB); anything bigger is not what the app sends. */
export const PHOTO_MAX_BYTES = 600_000;

export type PhotoStatus = "captured" | "denied" | "unavailable" | "upload_failed" | "none";

/**
 * The bytes of a `data:image/jpeg;base64,...` URL, or null when it is not a
 * JPEG of a sensible size. The magic bytes are checked, not just the label.
 */
export function decodeJpegDataUrl(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const m = /^data:image\/jpe?g;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m || m[1].length > Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 4) return null;
  const bytes = Uint8Array.from(Buffer.from(m[1], "base64"));
  if (bytes.length < 100 || bytes.length > PHOTO_MAX_BYTES) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return bytes;
}

/** Where a punch photo lives in the bucket: by month, then person, one file per punch. */
export function punchPhotoKey(staffId: string, punchId: string, day: string): string {
  return `DTR photos/${day.slice(0, 7)}/${staffId}/${punchId}.jpg`;
}
