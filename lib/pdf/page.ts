// The drawing half of the PDF writer (Nov 2026): pages of rectangles, lines, shapes and text, each also kept as SVG for an
// on-screen preview. No Node imports, so the browser can draw a report graph exactly as the PDF prints it.

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

export function escapeText(text: string): string {
  return toLatin(text).replace(/([\\()])/g, "\\$1");
}

export function num(value: number): string {
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

  /** A filled rectangle in colour (0..1 per channel): the bars and tints of a report. */
  fillRectRgb(x: number, yTop: number, width: number, height: number, rgb: [number, number, number]): void {
    const [r, g, b] = rgb;
    this.ops.push(`${num(r)} ${num(g)} ${num(b)} rg ${num(x)} ${num(A4.height - yTop - height)} ${num(width)} ${num(height)} re f 0 g`);
    this.svg.push(`<rect x="${num(x)}" y="${num(yTop)}" width="${num(width)}" height="${num(height)}" fill="rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})"/>`);
  }

  /** A straight line, for table rules and chart axes. */
  line(x1: number, y1: number, x2: number, y2: number, gray = 0.8, lineWidth = 0.5): void {
    this.ops.push(`${num(gray)} G ${num(lineWidth)} w ${num(x1)} ${num(A4.height - y1)} m ${num(x2)} ${num(A4.height - y2)} l S`);
    this.svg.push(`<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${svgGray(gray)}" stroke-width="${num(lineWidth)}"/>`);
  }

  /** A hairline outline, used for the cut guides around each label. */
  strokeRect(x: number, yTop: number, width: number, height: number, gray = 0.85, lineWidth = 0.5): void {
    this.ops.push(
      `${num(gray)} G ${num(lineWidth)} w ${num(x)} ${num(A4.height - yTop - height)} ${num(width)} ${num(height)} re S`
    );
    this.svg.push(`<rect x="${num(x)}" y="${num(yTop)}" width="${num(width)}" height="${num(height)}" fill="none" stroke="${svgGray(gray)}" stroke-width="${num(lineWidth)}"/>`);
  }

  text(x: number, yTop: number, size: number, value: string, options: { bold?: boolean; gray?: number; rgb?: Rgb; align?: "left" | "center" | "right" } = {}): void {
    const { bold = false, gray = 0, rgb, align = "left" } = options;
    const width = textWidth(value, size, bold);
    const drawX = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    const fill = rgb ? `${rgb.map(num).join(" ")} rg` : `${num(gray)} g`;
    this.ops.push(
      `BT ${fill} /${bold ? "F2" : "F1"} ${num(size)} Tf ${num(drawX)} ${num(A4.height - yTop - size)} Td (${escapeText(value)}) Tj ET${rgb ? " 0 g" : ""}`
    );
    // Arial has Helvetica's widths, so the x worked out above holds on screen too.
    this.svg.push(
      `<text x="${num(drawX)}" y="${num(yTop + size)}" font-size="${num(size)}"${bold ? ' font-weight="bold"' : ""} fill="${rgb ? svgRgb(rgb) : svgGray(gray)}">${escapeXml(toLatin(value))}</text>`
    );
  }

  /** A filled shape through the points (pie slices, areas, markers), in colour. */
  fillPath(points: [number, number][], rgb: Rgb): void {
    if (points.length < 3) return;
    const path = points.map(([x, y], i) => `${num(x)} ${num(A4.height - y)} ${i ? "l" : "m"}`).join(" ");
    this.ops.push(`q ${rgb.map(num).join(" ")} rg ${path} h f Q`);
    this.svg.push(`<polygon points="${points.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")}" fill="${svgRgb(rgb)}"/>`);
  }

  /** A line through the points (line graphs, goal lines), in colour; `dash` draws it dashed. */
  strokePath(points: [number, number][], rgb: Rgb, lineWidth = 1, dash = false): void {
    if (points.length < 2) return;
    const path = points.map(([x, y], i) => `${num(x)} ${num(A4.height - y)} ${i ? "l" : "m"}`).join(" ");
    this.ops.push(`q ${rgb.map(num).join(" ")} RG ${num(lineWidth)} w 1 j${dash ? " [3 2] 0 d" : ""} ${path} S Q`);
    this.svg.push(`<polyline points="${points.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")}" fill="none" stroke="${svgRgb(rgb)}" stroke-width="${num(lineWidth)}" stroke-linejoin="round"${dash ? ' stroke-dasharray="3 2"' : ""}/>`);
  }
}

/** A colour, 0..1 per channel. */
export type Rgb = [number, number, number];

function svgRgb([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

/** Part of a page as SVG (one graph for a preview), at the page's own scale. */
export function regionSvg(page: PdfPage, x: number, y: number, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x)} ${num(y)} ${num(width)} ${num(height)}" font-family="Helvetica, Arial, sans-serif"><rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" fill="#fff"/>${page.svg.join("")}</svg>`;
}

function svgGray(gray: number): string {
  const v = Math.round(gray * 255);
  return `rgb(${v},${v},${v})`;
}

export function escapeXml(text: string): string {
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
