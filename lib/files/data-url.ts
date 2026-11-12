/**
 * An uploaded file sent as a data URL, checked by its bytes and not just its label (0134, 0149): a JPEG must start
 * and end like one, a PNG carry its full 8-byte signature and an IHDR header, a PDF start with %PDF.
 */
const CHECKS: Record<string, (b: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9,
  "image/png": (b) =>
    b.length > 24 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x) && String.fromCharCode(b[12], b[13], b[14], b[15]) === "IHDR",
  "application/pdf": (b) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
};

export function decodeDataUrl(value: unknown, types: readonly string[], maxBytes: number): { bytes: Uint8Array; type: string } | null {
  if (typeof value !== "string") return null;
  const m = /^data:([a-z]+\/[a-z.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m || !types.includes(m[1]) || !CHECKS[m[1]] || m[2].length > Math.ceil((maxBytes * 4) / 3) + 4) return null;
  const bytes = Uint8Array.from(Buffer.from(m[2], "base64"));
  return bytes.length > 0 && bytes.length <= maxBytes && CHECKS[m[1]](bytes) ? { bytes, type: m[1] } : null;
}

/** Refuses a body far over the limit before it is read (base64 is 4/3 of the bytes, plus the JSON around it). */
export const tooLarge = (request: Request, maxBytes: number) => Number(request.headers.get("content-length") ?? 0) > Math.ceil((maxBytes * 4) / 3) + 4096;
