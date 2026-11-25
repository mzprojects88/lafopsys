// Patient ID cards (0164) on A4 for cutting, folding and laminating (owner, 18 Nov 2026): three cards a page,
// each front and back side by side (card size CR80, 54 x 85.6 mm) with a fold line between them. The QR
// holds the card's link (https://arkos.littlearkfoundation.org/c/<token>), drawn as vector squares as
// LAF Inventory draws its label QRs (bwip-js + the same run-length rectangles).
// Relative, with extensions, so node --test can load the layout without a bundler.
import { PdfPage, buildPdf, fitSize, textWidth, wrap, type PdfImage, type Rgb } from "./writer.ts";
import { CARD_THEMES, DEFAULT_CARD_TEMPLATE, type CardTemplate, type Rgb255 } from "../utils/id-card-template.ts";
import { ID_CARD_AVATAR, ID_CARD_BACK_ART, ID_CARD_FRONT_ART, ID_CARD_LOGO_PNG } from "./id-card-art.ts";
import { decodePng } from "./png.ts";

/** The address printed in every card's QR. Cards last for years, so it is LAF's own domain (owner, 18 Nov 2026). */
export const CARD_LINK_BASE = "https://arkos.littlearkfoundation.org/c/";

export interface IdCard {
  name: string;
  caseNumber: string | null;
  carer: { name: string; relationship: string | null } | null;
  version: number;
  /** "Nov 18, 2026" */
  issuedOn: string;
  token: string;
  /** Only with photo consent; otherwise the card shows the child's initials. */
  photo?: PdfImage;
}

const MM = 72 / 25.4;
const W = 54;
const H = 85.6;
const rgb = (r: number, g: number, b: number): Rgb => [r / 255, g / 255, b / 255];
const MUTED = 0.36;

/** A QR code's modules as rectangles fitted to a square of `size` (LAF Inventory's lib/pdf/symbols.ts):
 * neighbouring black modules on a row become one rectangle. */
export function qrRects(pixels: ArrayLike<number>, columns: number, rows: number, size: number) {
  const cell = size / columns;
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    let start = -1;
    for (let column = 0; column <= columns; column += 1) {
      const filled = column < columns && pixels[row * columns + column] !== 0;
      if (filled && start === -1) start = column;
      else if (!filled && start !== -1) {
        out.push({ x: start * cell, y: row * cell, w: (column - start) * cell, h: cell });
        start = -1;
      }
    }
  }
  return out;
}

/** The QR modules for a card's link (error correction M, the quiet zone is left white on the card). */
export const cardQr = (token: string) => textQr(CARD_LINK_BASE + token);

/** The QR modules for any text (error correction M); the booking documents use it for their link (0172). */
export async function textQr(text: string): Promise<{ pixels: ArrayLike<number>; columns: number; rows: number }> {
  const { default: bwipjs } = await import("bwip-js/node");
  const raw = await bwipjs.raw({ bcid: "qrcode", text, eclevel: "M" } as Parameters<typeof bwipjs.raw>[0]);
  const first = raw[0] as unknown as { pixs: number[]; pixx: number; pixy: number };
  return { pixels: first.pixs, columns: first.pixx, rows: first.pixy };
}

/** "Ana Sample" -> "AS"; a suffix ("Jr", "III") is not a name. */
export const initials = (name: string) => {
  const words = name.split(/\s+/).filter((w) => w && !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w));
  return [words[0], words.length > 1 ? words[words.length - 1] : undefined]
    .filter((w): w is string => !!w)
    .map((w) => w[0]!.toUpperCase())
    .join("");
};

/** The template's colours as PDF colours. */
function colours(t: CardTemplate) {
  const th = CARD_THEMES[t.theme];
  const c = (v: Rgb255): Rgb => rgb(v[0], v[1], v[2]);
  return { main: c(th.main), band: c(th.band), accent: c(th.accent), soft: c(th.soft), rule: c(th.rule) };
}
type Colours = ReturnType<typeof colours>;

function pill(page: PdfPage, x: number, y: number, h: number, text: string, size: number, fill: Rgb, ink: Rgb, padding: number) {
  const width = textWidth(text, size, true) + padding * 2;
  page.fillRectRgb(x, y, width, h, fill);
  page.text(x + padding, y + (h - size) / 2 + 0.3, size, text, { bold: true, rgb: ink });
  return width;
}

function footer(page: PdfPage, x: number, y: number, t: CardTemplate, k: Colours) {
  const inner = (W - 6) * MM;
  page.fillRectRgb(x, y + 71 * MM, W * MM, (H - 71) * MM, k.band);
  const [one, two] = t.footer;
  page.text(x + (W * MM) / 2, y + (two ? 74.6 : 76.4) * MM, fitSize(one, inner, 6.8, true, 4.6), one, { bold: true, rgb: [1, 1, 1], align: "center" });
  if (two) page.text(x + (W * MM) / 2, y + 78.8 * MM, fitSize(two, inner, 5, false, 4), two, { rgb: [1, 1, 1], align: "center" });
}

function front(page: PdfPage, x: number, y: number, card: IdCard, qr: { pixels: ArrayLike<number>; columns: number; rows: number }, logo: PdfImage, t: CardTemplate, k: Colours) {
  const m = (v: number) => v * MM;
  const left = x + m(3.4);
  const inner = m(W - 6.8);
  // Header: logo and the title pill, then a light rule.
  page.image(logo, left, y + m(3.4), m(26), (m(26) * logo.height) / logo.width);
  const titleSize = fitSize(t.title, m(20) - m(3.6), 5.6, true, 4.2);
  const pillWidth = textWidth(t.title, titleSize, true) + m(1.8) * 2;
  pill(page, x + m(W - 3.4) - pillWidth, y + m(3.9), m(3.6), t.title, titleSize, k.accent, k.main, m(1.8));
  page.fillRectRgb(x, y + m(10.4), m(W), 0.6, k.rule);

  // Photo (with consent) or initials; the QR beside it, with its quiet zone kept white.
  const photoX = left;
  const photoY = y + m(13);
  if (card.photo) {
    page.image(card.photo, photoX, photoY, m(20), m(24));
  } else {
    page.fillRectRgb(photoX, photoY, m(20), m(24), k.soft);
    page.text(photoX + m(10), photoY + m(12) - 9, 18, initials(card.name), { bold: true, rgb: k.band, align: "center" });
  }
  const qrSize = m(21);
  const qrX = x + m(W - 3.4 - 1.5) - qrSize;
  const qrY = y + m(14.2);
  for (const r of qrRects(qr.pixels, qr.columns, qr.rows, qrSize)) page.fillRectRgb(qrX + r.x, qrY + r.y, r.w, r.h, k.main);
  if (t.qrCaption) page.text(qrX + qrSize / 2, y + m(36.4), fitSize(t.qrCaption, qrSize + m(3), 4.5, false, 3.6), t.qrCaption, { gray: MUTED, align: "center" });

  // Who: the child's full name, then the lines the template shows.
  const nameSize = fitSize(card.name, inner, 13, true, 8);
  const nameLines = textWidth(card.name, nameSize, true) <= inner ? [card.name] : wrap(card.name, inner, nameSize).slice(0, 2);
  let cursor = y + m(39.6);
  for (const line of nameLines) {
    page.text(left, cursor, nameSize, line, { bold: true, rgb: k.main });
    cursor += nameSize * 1.12;
  }
  cursor += m(1);
  if (t.show.caseNumber && card.caseNumber) {
    pill(page, left, cursor, m(4.2), card.caseNumber, 7.2, k.band, [1, 1, 1], m(2.2));
    cursor += m(5.6);
  }
  if (t.show.carer && card.carer) {
    const carer = `Carer: ${card.carer.name}${card.carer.relationship ? ` · ${card.carer.relationship}` : ""}`;
    page.text(left, cursor, fitSize(carer, inner, 6.2, false, 4.6), carer, { gray: 0.1 });
    cursor += m(3);
  }
  if (t.show.cardLine) page.text(left, cursor, 5.2, `Card ${card.version} · Issued ${card.issuedOn}`, { gray: MUTED });

  // What it is used for: the marks the template names.
  const marks = t.show.marks ? t.marks.filter(Boolean) : [];
  if (marks.length) {
    const gap = m(1.2);
    const box = (inner - gap * (marks.length - 1)) / marks.length;
    marks.forEach((label, i) => {
      const bx = left + i * (box + gap);
      page.fillRectRgb(bx, y + m(62.6), box, m(5.6), k.soft);
      page.text(bx + box / 2, y + m(64.4), fitSize(label, box - m(1), 5.4, true, 4), label, { bold: true, rgb: k.band, align: "center" });
    });
  }
  footer(page, x, y, t, k);
}

function back(page: PdfPage, x: number, y: number, logo: PdfImage, address: string, t: CardTemplate, k: Colours) {
  const m = (v: number) => v * MM;
  const left = x + m(3.6);
  const inner = m(W - 7.2);
  const logoW = m(24);
  page.image(logo, x + (m(W) - logoW) / 2, y + m(4), logoW, (logoW * logo.height) / logo.width);
  const found = t.back.found ? (address ? `${t.back.found}, ${address}.` : `${t.back.found}.`) : "";
  const paras = [t.back.intro, t.back.lost, found].filter(Boolean);
  const headings = t.back.heading.filter(Boolean);
  // The largest text size at which everything fits above the footer (long texts print smaller).
  const top = 11.6 + headings.length * 3.4 + 1.4;
  const heightAt = (size: number) =>
    paras.reduce((h, p) => h + (wrap(p, inner, size).length * size * 1.38) / MM + 1.6, 0) +
    (t.back.privacy ? (wrap(t.back.privacy, inner - m(4), size - 0.2).length * (size - 0.2) * 1.38) / MM + 3 + 2.2 : 0);
  const size = [5.8, 5.4, 5, 4.6, 4.2].find((s) => top + heightAt(s) <= 70) ?? 4.2;

  let cursor = y + m(11.6);
  for (const line of headings) {
    page.text(left, cursor, fitSize(line, inner, 8.2, true, 6), line, { bold: true, rgb: k.main });
    cursor += 9.6;
  }
  cursor += m(1.4);
  const para = (text: string) => {
    for (const line of wrap(text, inner, size)) {
      page.text(left, cursor, size, line, { gray: 0.1 });
      cursor += size * 1.38;
    }
    cursor += m(1.6);
  };
  if (t.back.intro) para(t.back.intro);
  if (t.back.privacy) {
    // The privacy box reads a touch smaller than the paragraphs (as on the 18 Nov design).
    const box = size - 0.2;
    const boxLines = wrap(t.back.privacy, inner - m(4), box);
    const boxH = boxLines.length * box * 1.38 + m(3);
    page.fillRectRgb(left, cursor, inner, boxH, k.soft);
    let by = cursor + m(1.5);
    for (const line of boxLines) {
      page.text(left + m(2), by, box, line, { rgb: k.main });
      by += box * 1.38;
    }
    cursor += boxH + m(2.2);
  }
  if (t.back.lost) para(t.back.lost);
  if (found) para(found);
  footer(page, x, y, t, k);
}

// ---- The storybook design (owner's sample, 21 Nov 2026; laf-brand skill): artwork behind live text ----

const art = (a: { width: number; height: number; base64: string }): PdfImage => ({ jpeg: Buffer.from(a.base64, "base64"), width: a.width, height: a.height });
const FRONT_ART = art(ID_CARD_FRONT_ART);
const BACK_ART = art(ID_CARD_BACK_ART);
const AVATAR = art(ID_CARD_AVATAR);
/** The logo on a transparent background (the JPEG logo carries a white box, which would show on the sky). */
const LOGO_CLEAR: PdfImage | null = decodePng(Buffer.from(ID_CARD_LOGO_PNG.base64, "base64"));
const WHITE: Rgb = [1, 1, 1];
const SLATE = rgb(85, 112, 134);
/** A CR80 card's corner radius, for the cut line. */
const CARD_RADIUS = 3.18;

/** A rounded rectangle as a polygon (corners in `steps` segments), top-down points. */
function roundRect(x: number, y: number, w: number, h: number, r: number, steps = 6): [number, number][] {
  const rr = Math.min(r, w / 2, h / 2);
  const pts: [number, number][] = [];
  const corner = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = from + (Math.PI / 2) * (i / steps);
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  };
  corner(x + w - rr, y + rr, -Math.PI / 2); // top right
  corner(x + w - rr, y + h - rr, 0); // bottom right
  corner(x + rr, y + h - rr, Math.PI / 2); // bottom left
  corner(x + rr, y + rr, Math.PI); // top left
  return pts;
}

/** Paints the tile's colour over a picture's square corners, so it reads as rounded. */
function roundCorners(page: PdfPage, x: number, y: number, w: number, h: number, r: number, fill: Rgb) {
  const steps = 6;
  const arc = (cx: number, cy: number, from: number, sx: number, sy: number) => {
    const pts: [number, number][] = [[sx, sy]];
    for (let i = 0; i <= steps; i++) {
      const a = from + (Math.PI / 2) * (i / steps);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    page.fillPath(pts, fill);
  };
  arc(x + r, y + r, Math.PI, x, y);
  arc(x + w - r, y + r, -Math.PI / 2, x + w, y);
  arc(x + w - r, y + h - r, 0, x + w, y + h);
  arc(x + r, y + h - r, Math.PI / 2, x, y + h);
}

/** A pill with centred text; returns its width. */
function pillCentered(page: PdfPage, cx: number, y: number, h: number, text: string, size: number, fill: Rgb, ink: Rgb, pad: number) {
  const w = textWidth(text, size, true) + pad * 2;
  page.fillPath(roundRect(cx - w / 2, y, w, h, h / 2), fill);
  page.text(cx, y + (h - size) / 2 + 0.35, size, text, { bold: true, rgb: ink, align: "center" });
  return w;
}

/** The footer on the waves; the back's is a little smaller, clear of the hearts in its artwork. */
function storyFooter(page: PdfPage, x: number, y: number, t: CardTemplate, side: "front" | "back" = "front") {
  const m = (v: number) => v * MM;
  const [one, two] = t.footer;
  const inner = m(side === "back" ? W - 24 : W - 12);
  const drop = side === "back" ? 2 : 0;
  page.text(x + m(W / 2), y + m((two ? 76.2 : 78) + drop), fitSize(one, inner, side === "back" ? 6.2 : 7.4, true, 4.6), one, { bold: true, rgb: WHITE, align: "center" });
  if (two) page.text(x + m(W / 2), y + m(80.4 + drop), fitSize(two, inner, 5.4, false, 4.2), two, { rgb: WHITE, align: "center" });
}

function storyFront(page: PdfPage, x: number, y: number, card: IdCard, qr: { pixels: ArrayLike<number>; columns: number; rows: number }, t: CardTemplate, k: Colours) {
  const m = (v: number) => v * MM;
  page.image(FRONT_ART, x, y, m(W), m(H));
  // Header: the logo, then the title pill at the right.
  const logo = LOGO_CLEAR;
  if (logo) page.image(logo, x + m(3.4), y + m(4), m(27), (m(27) * logo.height) / logo.width);
  const titleSize = fitSize(t.title, m(18), 6.2, true, 4.4);
  const titleW = textWidth(t.title, titleSize, true) + m(2.4) * 2;
  page.fillPath(roundRect(x + m(W - 3.2) - titleW, y + m(4.2), titleW, m(5), m(2.5)), k.accent);
  page.text(x + m(W - 3.2) - titleW / 2, y + m(4.2) + (m(5) - titleSize) / 2 + 0.35, titleSize, t.title, { bold: true, rgb: k.main, align: "center" });

  // The two tiles: the photo (or the illustrated child) and the QR.
  const tileY = y + m(12.4);
  const tileW = m(22.4);
  const tileH = m(26.4);
  const left = x + m(3.4);
  const right = x + m(W - 3.4) - tileW;
  for (const tx of [left, right]) page.fillPath(roundRect(tx, tileY, tileW, tileH, m(2.6)), WHITE);
  const pic = card.photo ?? AVATAR;
  const pw = m(20.2);
  const ph = m(24.2);
  page.image(pic, left + (tileW - pw) / 2, tileY + (tileH - ph) / 2, pw, ph);
  roundCorners(page, left + (tileW - pw) / 2, tileY + (tileH - ph) / 2, pw, ph, m(1.8), WHITE);
  const qrSize = m(19.4);
  const qrX = right + (tileW - qrSize) / 2;
  for (const r of qrRects(qr.pixels, qr.columns, qr.rows, qrSize)) page.fillRectRgb(qrX + r.x, tileY + m(1.5) + r.y, r.w, r.h, [0.04, 0.07, 0.12]);
  if (t.qrCaption) page.text(right + tileW / 2, tileY + m(22.4), fitSize(t.qrCaption.toUpperCase(), tileW - m(2), 4.6, true, 3.4), t.qrCaption.toUpperCase(), { bold: true, rgb: k.main, align: "center" });

  // The child's name, big and centred; the LFCN pill; the lines the template shows.
  const inner = m(W - 7);
  const cx = x + m(W / 2);
  const name = card.name.toUpperCase();
  const nameSize = fitSize(name, inner, 15, true, 10);
  const nameLines = textWidth(name, nameSize, true) <= inner ? [name] : wrap(name, inner, nameSize).slice(0, 2);
  let cursor = y + m(41.6);
  for (const line of nameLines) {
    page.text(cx, cursor, fitSize(line, inner, nameSize, true, 7), line, { bold: true, rgb: k.main, align: "center" });
    cursor += nameSize * 1.08;
  }
  cursor += m(1.4);
  if (t.show.caseNumber && card.caseNumber) {
    pillCentered(page, cx, cursor, m(5.6), card.caseNumber, 8.4, k.band, WHITE, m(4));
    cursor += m(7);
  }
  if (t.show.carer && card.carer) {
    const carer = `Carer: ${card.carer.name}${card.carer.relationship ? ` · ${card.carer.relationship}` : ""}`;
    page.text(cx, cursor, fitSize(carer, inner, 6.2, false, 4.6), carer, { rgb: SLATE, align: "center" });
    cursor += m(2.9);
  }
  if (t.scanLine) {
    page.text(cx, cursor, fitSize(t.scanLine, inner, 7.4, true, 5), t.scanLine, { bold: true, rgb: k.band, align: "center" });
    cursor += m(3.4);
  }
  if (t.show.cardLine) page.text(cx, cursor, 4.8, `Card ${card.version} · Issued ${card.issuedOn}`, { rgb: SLATE, align: "center" });
  const marks = t.show.marks ? t.marks.filter(Boolean) : [];
  if (marks.length) {
    const gap = m(1.2);
    const box = (inner - m(8) - gap * (marks.length - 1)) / marks.length;
    marks.forEach((label, i) => {
      const bx = x + m(7.5) + i * (box + gap);
      page.fillPath(roundRect(bx, y + m(64.2), box, m(4.4), m(2.2)), WHITE);
      page.text(bx + box / 2, y + m(65.4), fitSize(label, box - m(1), 5.2, true, 4), label, { bold: true, rgb: k.band, align: "center" });
    });
  }
  storyFooter(page, x, y, t);
}

function storyBack(page: PdfPage, x: number, y: number, address: string, t: CardTemplate, k: Colours) {
  const m = (v: number) => v * MM;
  page.image(BACK_ART, x, y, m(W), m(H));
  const logo = LOGO_CLEAR;
  if (logo) page.image(logo, x + (m(W) - m(26)) / 2, y + m(6.4), m(26), (m(26) * logo.height) / logo.width);
  const left = x + m(4.4);
  const inner = m(W - 8.8);
  const found = t.back.found ? (address ? `${t.back.found}, ${address}.` : `${t.back.found}.`) : "";
  const paras = [t.back.intro, t.back.lost, found].filter(Boolean);
  const headings = t.back.heading.filter(Boolean);
  const top = 13.6 + headings.length * 3.6 + 1.6;
  const heightAt = (size: number) =>
    paras.reduce((h, p) => h + (wrap(p, inner, size).length * size * 1.4) / MM + 1.8, 0) +
    (t.back.privacy ? (wrap(t.back.privacy, inner - m(4), size - 0.2).length * (size - 0.2) * 1.4) / MM + 3.4 + 2.2 : 0);
  const size = [6, 5.6, 5.2, 4.8, 4.4].find((s) => top + heightAt(s) <= 64) ?? 4.4;

  let cursor = y + m(13.6);
  for (const line of headings) {
    page.text(x + m(W / 2), cursor, fitSize(line, inner, 8.6, true, 6), line, { bold: true, rgb: k.main, align: "center" });
    cursor += 10.2;
  }
  cursor += m(1.6);
  const para = (text: string) => {
    for (const line of wrap(text, inner, size)) {
      page.text(left, cursor, size, line, { rgb: k.main });
      cursor += size * 1.4;
    }
    cursor += m(1.8);
  };
  if (t.back.intro) para(t.back.intro);
  if (t.back.privacy) {
    const box = size - 0.2;
    const lines = wrap(t.back.privacy, inner - m(4), box);
    const boxH = lines.length * box * 1.4 + m(3.4);
    page.fillPath(roundRect(left, cursor, inner, boxH, m(2.2)), WHITE);
    let by = cursor + m(1.7);
    for (const line of lines) {
      page.text(left + m(2), by, box, line, { rgb: k.band, bold: true });
      by += box * 1.4;
    }
    cursor += boxH + m(2.2);
  }
  if (t.back.lost) para(t.back.lost);
  if (found) para(found);
  storyFooter(page, x, y, t, "back");
}

/** The cut line: the card's real rounded corners. */
function cutLine(page: PdfPage, x: number, y: number) {
  const pts = roundRect(x, y, W * MM, H * MM, CARD_RADIUS * MM, 8);
  page.strokePath([...pts, pts[0]!], [0.62, 0.62, 0.62], 0.5);
}

/**
 * The cards on A4, in the template's layout (0169):
 *  - fold: three a page, each front and back side by side, a dashed fold line between them (cut, fold, laminate);
 *  - duplex: nine fronts a page, then their nine backs on the next page in mirrored columns, for a printer that
 *    prints both sides (flip on the long edge), then cut.
 */
export async function buildIdCardsPdf(cards: IdCard[], assets: { logo: PdfImage; address: string; template?: CardTemplate }): Promise<Buffer> {
  const t = assets.template ?? DEFAULT_CARD_TEMPLATE;
  const k = colours(t);
  const story = t.theme === "storybook";
  const pages: PdfPage[] = [];
  const m = (v: number) => v * MM;
  if (t.layout === "duplex") {
    const gap = 4;
    const x0 = (210 - (3 * W + 2 * gap)) / 2;
    const y0 = (297 - (3 * H + 2 * gap)) / 2 + 3;
    const at = (slot: number, mirror: boolean) => {
      const col = slot % 3;
      return { x: m(x0 + (mirror ? 2 - col : col) * (W + gap)), y: m(y0 + Math.floor(slot / 3) * (H + gap)) };
    };
    for (let i = 0; i < cards.length; i += 9) {
      const batch = cards.slice(i, i + 9);
      const fronts = new PdfPage();
      fronts.text(m(x0), m(8), 7.5, "LAF Patient ID cards, fronts: print both sides (flip on the long edge), then cut along the lines.", { gray: MUTED });
      const backs = new PdfPage();
      for (const [slot, card] of batch.entries()) {
        const f = at(slot, false);
        if (story) {
          storyFront(fronts, f.x, f.y, card, await cardQr(card.token), t, k);
          cutLine(fronts, f.x, f.y);
        } else {
          front(fronts, f.x, f.y, card, await cardQr(card.token), assets.logo, t, k);
          fronts.strokeRect(f.x, f.y, m(W), m(H), 0.62, 0.5);
        }
        const b = at(slot, true);
        if (story) {
          storyBack(backs, b.x, b.y, assets.address, t, k);
          cutLine(backs, b.x, b.y);
        } else {
          back(backs, b.x, b.y, assets.logo, assets.address, t, k);
          backs.strokeRect(b.x, b.y, m(W), m(H), 0.62, 0.5);
        }
      }
      pages.push(fronts, backs);
    }
    return buildPdf(pages, "LAF Patient ID cards");
  }
  const pairW = m(W * 2);
  const x0 = (m(210) - pairW) / 2;
  for (let i = 0; i < cards.length; i += 3) {
    const page = new PdfPage();
    page.text(x0, m(8), 7.5, "LAF Patient ID cards: cut along the outer line, fold on the dashed line, laminate.", { gray: MUTED });
    for (const [slot, card] of cards.slice(i, i + 3).entries()) {
      const y = m(16) + slot * m(H + 8);
      if (story) {
        storyFront(page, x0, y, card, await cardQr(card.token), t, k);
        storyBack(page, x0 + m(W), y, assets.address, t, k);
      } else {
        front(page, x0, y, card, await cardQr(card.token), assets.logo, t, k);
        back(page, x0 + m(W), y, assets.logo, assets.address, t, k);
      }
      page.strokeRect(x0, y, pairW, m(H), 0.62, 0.5);
      page.strokePath([[x0 + m(W), y], [x0 + m(W), y + m(H)]], [0.55, 0.55, 0.55], 0.5, true);
    }
    pages.push(page);
  }
  return buildPdf(pages, "LAF Patient ID cards");
}

/** Made-up children for the maker's preview and test sheet: a short and a long name, with and without a carer. */
export const SAMPLE_CARDS: IdCard[] = [
  { name: "Ana Sample", caseNumber: "LFCN-2026-0001", carer: { name: "Rosa Sample", relationship: "Mother" }, version: 1, issuedOn: "Nov 21, 2026", token: "00000000000000000000000000000001" },
  { name: "Juan Miguel Santiago Sample-Delacruz Jr.", caseNumber: "LFCN-2026-0002", carer: { name: "Teresita Sample-Delacruz", relationship: "Grandmother" }, version: 2, issuedOn: "Nov 21, 2026", token: "00000000000000000000000000000002" },
  { name: "Liza Sample", caseNumber: null, carer: null, version: 1, issuedOn: "Nov 21, 2026", token: "00000000000000000000000000000003" },
];
