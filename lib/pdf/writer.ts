import { deflateSync } from "node:zlib";

/**
 * A very small PDF writer, enough for sheets of labels and nothing more.
 *
 * Written by hand rather than pulled from a package because the whole job is
 * filled rectangles and short lines of text. Codes are drawn as vector
 * rectangles instead of pictures, which is what keeps the files small and
 * makes them print sharp at any size: a sheet of fifty codes lands in tens of
 * kilobytes rather than the megabytes a page of images would cost.
 *
 * Text uses Helvetica, one of the fourteen faces every PDF reader already
 * has, so no font is embedded. Pictures are JPEGs, which a PDF carries as
 * they are (DCTDecode) -- no decoding, no library -- enough for a logo.
 */

export const A4 = { width: 595.28, height: 841.89 };

/** Helvetica advance widths per 1000 units, for the characters a label uses.
 * Anything unlisted falls back to a middling width; being a point or two out
 * only shifts centring, it never breaks a layout. */
const WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584,
};
const DEFAULT_WIDTH = 556;
const BOLD_FACTOR = 1.04;

/** The label text people type is not always plain ASCII, and the base fonts
 * only reliably carry the Latin range. Anything outside it becomes the nearest
 * plain equivalent rather than a box or a dropped glyph. */
export function toLatin(text: string): string {
  return text
    // "Nescafé" -> "Nescafe": drop the accent, keep the letter.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[›»]/g, ">")
    .replace(/[‹«]/g, "<")
    .replace(/[·•]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^ -~]/g, "");
}

export function textWidth(text: string, size: number, bold = false): number {
  let total = 0;
  for (const char of toLatin(text)) total += WIDTHS[char] ?? DEFAULT_WIDTH;
  return (total / 1000) * size * (bold ? BOLD_FACTOR : 1);
}

/** Splits text into lines no wider than width at this size (regular weight). */
export function wrap(text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Shrinks the size until the string fits, rather than letting it run into the
 * next label. Returns the size to draw at. */
export function fitSize(text: string, maxWidth: number, size: number, bold = false, min = 5): number {
  let current = size;
  while (current > min && textWidth(text, current, bold) > maxWidth) current -= 0.5;
  return current;
}

function escapeText(text: string): string {
  return toLatin(text).replace(/([\\()])/g, "\\$1");
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** A JPEG to place on a page; the same object on several pages is stored once. */
export interface PdfImage {
  jpeg: Buffer;
  width: number;
  height: number;
}

export class PdfPage {
  readonly ops: string[] = [];
  readonly images: PdfImage[] = [];
  /** The same drawing as SVG elements, for an on-screen preview (see pageSvg). */
  readonly svg: string[] = [];

  /** Draws a JPEG scaled to width x height points, top-left at (x, yTop). */
  image(img: PdfImage, x: number, yTop: number, width: number, height: number): void {
    let index = this.images.indexOf(img);
    if (index < 0) index = this.images.push(img) - 1;
    this.ops.push(`q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(A4.height - yTop - height)} cm /Im${index + 1} Do Q`);
    this.svg.push(`<image x="${num(x)}" y="${num(yTop)}" width="${num(width)}" height="${num(height)}" href="data:image/jpeg;base64,${img.jpeg.toString("base64")}"/>`);
  }

  /** PDF's origin is the bottom left; every caller here thinks top-down, so y
   * is flipped once, here. */
  fillRect(x: number, yTop: number, width: number, height: number, gray = 0): void {
    this.ops.push(`${num(gray)} g ${num(x)} ${num(A4.height - yTop - height)} ${num(width)} ${num(height)} re f`);
    this.svg.push(`<rect x="${num(x)}" y="${num(yTop)}" width="${num(width)}" height="${num(height)}" fill="${svgGray(gray)}"/>`);
  }

  /** A hairline outline, used for the cut guides around each label. */
  strokeRect(x: number, yTop: number, width: number, height: number, gray = 0.85, lineWidth = 0.5): void {
    this.ops.push(
      `${num(gray)} G ${num(lineWidth)} w ${num(x)} ${num(A4.height - yTop - height)} ${num(width)} ${num(height)} re S`
    );
    this.svg.push(`<rect x="${num(x)}" y="${num(yTop)}" width="${num(width)}" height="${num(height)}" fill="none" stroke="${svgGray(gray)}" stroke-width="${num(lineWidth)}"/>`);
  }

  text(x: number, yTop: number, size: number, value: string, options: { bold?: boolean; gray?: number; align?: "left" | "center" | "right" } = {}): void {
    const { bold = false, gray = 0, align = "left" } = options;
    const width = textWidth(value, size, bold);
    const drawX = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    this.ops.push(
      `BT ${num(gray)} g /${bold ? "F2" : "F1"} ${num(size)} Tf ${num(drawX)} ${num(A4.height - yTop - size)} Td (${escapeText(value)}) Tj ET`
    );
    // Arial has Helvetica's widths, so the x worked out above holds on screen too.
    this.svg.push(
      `<text x="${num(drawX)}" y="${num(yTop + size)}" font-size="${num(size)}"${bold ? ' font-weight="bold"' : ""} fill="${svgGray(gray)}">${escapeXml(toLatin(value))}</text>`
    );
  }
}

function svgGray(gray: number): string {
  const v = Math.round(gray * 255);
  return `rgb(${v},${v},${v})`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A page as a standalone SVG, drawn exactly as its PDF page: phones show an
 * image inline where they would only download a PDF. */
export function pageSvg(page: PdfPage): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(A4.width)} ${num(A4.height)}" font-family="Helvetica, Arial, sans-serif">` +
    `<rect width="100%" height="100%" fill="#fff"/>${page.svg.join("")}</svg>`
  );
}

/** Assembles the pages into a file. Content streams are deflated, which is
 * where most of the saving comes from once a page holds a few hundred
 * rectangles. */
export function buildPdf(pages: PdfPage[], title: string): Buffer {
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (text: string | Buffer) => {
    const buf = Buffer.isBuffer(text) ? text : Buffer.from(text, "latin1");
    chunks.push(buf);
    length += buf.length;
  };
  const startObject = (index: number) => {
    offsets[index] = length;
    push(`${index} 0 obj\n`);
  };

  push("%PDF-1.4\n");

  const pageCount = Math.max(pages.length, 1);
  const fontRegular = 3;
  const fontBold = 4;
  const firstPage = 5;
  const pageIds = Array.from({ length: pageCount }, (_, i) => firstPage + i * 2);

  startObject(1);
  push(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  startObject(2);
  push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>\nendobj\n`);

  startObject(fontRegular);
  push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);

  startObject(fontBold);
  push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`);

  const rendered = pages.length > 0 ? pages : [new PdfPage()];
  // Images are written after the info object; pages refer ahead to them.
  const images = [...new Set(rendered.flatMap((page) => page.images))];
  const imageId = (img: PdfImage) => firstPage + pageCount * 2 + 1 + images.indexOf(img);
  rendered.forEach((page, index) => {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const xobjects = page.images.map((img, i) => `/Im${i + 1} ${imageId(img)} 0 R`).join(" ");
    startObject(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(A4.width)} ${num(A4.height)}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> /Contents ${contentId} 0 R >>\nendobj\n`
    );

    const stream = deflateSync(Buffer.from(page.ops.join("\n"), "latin1"));
    startObject(contentId);
    push(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`);
    push(stream);
    push("\nendstream\nendobj\n");
  });

  const infoId = firstPage + pageCount * 2;
  startObject(infoId);
  push(`<< /Title (${escapeText(title)}) /Producer (LAF Inventory) >>\nendobj\n`);

  images.forEach((img) => {
    startObject(imageId(img));
    push(
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
    );
    push(img.jpeg);
    push("\nendstream\nendobj\n");
  });

  const xrefOffset = length;
  const maxId = infoId + images.length;
  push(`xref\n0 ${maxId + 1}\n`);
  push("0000000000 65535 f \n");
  for (let id = 1; id <= maxId; id += 1) {
    const offset = offsets[id] ?? 0;
    push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
