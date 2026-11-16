// A signature picture for the PDF writer (0153): a PNG decoded to the two streams a PDF takes (colour, and the
// transparency as a soft mask), or a JPEG passed through as it is. Small on purpose: 8-bit, non-interlaced PNGs
// (grey, RGB, palette, with or without alpha), which is what phones, scanners and editors save. Anything else gives
// null and the document prints without the picture. Wide pictures are thinned to about 600 px.
import { deflateSync, inflateSync } from "node:zlib";
import type { PdfImage } from "./page.ts";

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_PIXELS = 24_000_000;

export function decodePng(bytes: Uint8Array): PdfImage | null {
  const b = Buffer.from(bytes);
  if (b.length < 33 || PNG_HEAD.some((v, i) => b[i] !== v)) return null;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let p = 8; p + 12 <= b.length; ) {
    const len = b.readUInt32BE(p);
    const name = b.toString("latin1", p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (p + 12 + len > b.length) return null;
    if (name === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      type = data[9]!;
      interlace = data[12]!;
    } else if (name === "PLTE") palette = Buffer.from(data);
    else if (name === "tRNS") trns = Buffer.from(data);
    else if (name === "IDAT") idat.push(Buffer.from(data));
    else if (name === "IEND") break;
    p += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!width || !height || depth !== 8 || interlace !== 0 || !channels || width * height > MAX_PIXELS || (type === 3 && !palette)) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  // Undo the per-row filters, in place.
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    const up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels]! : 0;
      const u = up ? up[x]! : 0;
      const c = up && x >= channels ? up[x - channels]! : 0;
      let v = row[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += u;
      else if (filter === 3) v += (a + u) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(u - c), pb = Math.abs(a - c), pc = Math.abs(a + u - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c;
      } else if (filter !== 0) return null;
      out[x] = v & 255;
    }
  }
  // To RGB and alpha, keeping every `step`-th pixel of a wide picture.
  const step = Math.max(1, Math.ceil(width / 600));
  const w = Math.ceil(width / step), h = Math.ceil(height / step);
  const rgb = Buffer.alloc(w * h * 3);
  const alpha = Buffer.alloc(w * h, 255);
  let seeThrough = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * step * width + x * step) * channels;
      const d = y * w + x;
      let r: number, g: number, bl: number, a = 255;
      if (type === 0 || type === 4) {
        r = g = bl = px[s]!;
        if (type === 4) a = px[s + 1]!;
      } else if (type === 3) {
        const i = px[s]!;
        r = palette![i * 3] ?? 0;
        g = palette![i * 3 + 1] ?? 0;
        bl = palette![i * 3 + 2] ?? 0;
        a = trns && i < trns.length ? trns[i]! : 255;
      } else {
        r = px[s]!;
        g = px[s + 1]!;
        bl = px[s + 2]!;
        if (type === 6) a = px[s + 3]!;
      }
      rgb[d * 3] = r;
      rgb[d * 3 + 1] = g;
      rgb[d * 3 + 2] = bl;
      alpha[d] = a;
      if (a !== 255) seeThrough = true;
    }
  }
  return { width: w, height: h, rgb: deflateSync(rgb), alpha: seeThrough ? deflateSync(alpha) : undefined, png: b };
}

/** A JPEG's size from its frame header, or null. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = Buffer.from(bytes);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let p = 2; p + 9 < b.length; ) {
    if (b[p] !== 0xff) return null;
    const marker = b[p + 1]!;
    const len = b.readUInt16BE(p + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(p + 5), width: b.readUInt16BE(p + 7) };
    p += 2 + len;
  }
  return null;
}

/** An uploaded signature (PNG or JPEG) as a picture the PDF writer can place, or null when it can't be read. */
export function signatureImage(bytes: Uint8Array, contentType: string): PdfImage | null {
  if (contentType === "image/png") return decodePng(bytes);
  const size = jpegSize(bytes);
  return size ? { jpeg: Buffer.from(bytes), ...size } : null;
}
