// Patient ID cards (0164) on A4 for cutting, folding and laminating (owner, 18 Nov 2026): three cards a page,
// each front and back side by side (card size CR80, 54 x 85.6 mm) with a fold line between them. The QR
// holds the card's link (https://arkos.littlearkfoundation.org/c/<token>), drawn as vector squares as
// LAF Inventory draws its label QRs (bwip-js + the same run-length rectangles).
// Relative, with extensions, so node --test can load the layout without a bundler.
import { PdfPage, buildPdf, fitSize, textWidth, wrap, type PdfImage, type Rgb } from "./writer.ts";

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
const NAVY = rgb(5, 45, 93);
const BLUE = rgb(0, 91, 168);
const PALE = rgb(242, 249, 253);
const YELLOW = rgb(255, 200, 61);
const RULE = rgb(227, 238, 247);
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
export async function cardQr(token: string): Promise<{ pixels: ArrayLike<number>; columns: number; rows: number }> {
  const { default: bwipjs } = await import("bwip-js/node");
  const raw = await bwipjs.raw({ bcid: "qrcode", text: CARD_LINK_BASE + token, eclevel: "M" } as Parameters<typeof bwipjs.raw>[0]);
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

function pill(page: PdfPage, x: number, y: number, h: number, text: string, size: number, fill: Rgb, ink: Rgb, padding: number) {
  const width = textWidth(text, size, true) + padding * 2;
  page.fillRectRgb(x, y, width, h, fill);
  page.text(x + padding, y + (h - size) / 2 + 0.3, size, text, { bold: true, rgb: ink });
  return width;
}

function footer(page: PdfPage, x: number, y: number) {
  page.fillRectRgb(x, y + 71 * MM, W * MM, (H - 71) * MM, BLUE);
  page.text(x + (W * MM) / 2, y + 74.6 * MM, 6.8, "Our Children. Our Future.", { bold: true, rgb: [1, 1, 1], align: "center" });
  page.text(x + (W * MM) / 2, y + 78.8 * MM, 5, "littlearkfoundation.org", { rgb: [1, 1, 1], align: "center" });
}

function front(page: PdfPage, x: number, y: number, card: IdCard, qr: { pixels: ArrayLike<number>; columns: number; rows: number }, logo: PdfImage) {
  const m = (v: number) => v * MM;
  const left = x + m(3.4);
  const inner = m(W - 6.8);
  // Header: logo and the yellow "PATIENT ID" pill, then a light rule.
  page.image(logo, left, y + m(3.4), m(26), (m(26) * logo.height) / logo.width);
  const pillWidth = textWidth("PATIENT ID", 5.6, true) + m(1.8) * 2;
  pill(page, x + m(W - 3.4) - pillWidth, y + m(3.9), m(3.6), "PATIENT ID", 5.6, YELLOW, NAVY, m(1.8));
  page.fillRectRgb(x, y + m(10.4), m(W), 0.6, RULE);

  // Photo (with consent) or initials; the QR beside it, with its quiet zone kept white.
  const photoX = left;
  const photoY = y + m(13);
  if (card.photo) {
    page.image(card.photo, photoX, photoY, m(20), m(24));
  } else {
    page.fillRectRgb(photoX, photoY, m(20), m(24), PALE);
    const letters = initials(card.name);
    page.text(photoX + m(10), photoY + m(12) - 9, 18, letters, { bold: true, rgb: BLUE, align: "center" });
  }
  const qrSize = m(21);
  const qrX = x + m(W - 3.4 - 1.5) - qrSize;
  const qrY = y + m(14.2);
  for (const r of qrRects(qr.pixels, qr.columns, qr.rows, qrSize)) page.fillRectRgb(qrX + r.x, qrY + r.y, r.w, r.h, NAVY);
  page.text(qrX + qrSize / 2, y + m(36.4), 4.5, "For LAF staff to scan", { gray: MUTED, align: "center" });

  // Who: the child's full name, the case number, the carer, which card this is.
  const nameSize = fitSize(card.name, inner, 13, true, 8);
  const nameLines = textWidth(card.name, nameSize, true) <= inner ? [card.name] : wrap(card.name, inner, nameSize).slice(0, 2);
  let cursor = y + m(39.6);
  for (const line of nameLines) {
    page.text(left, cursor, nameSize, line, { bold: true, rgb: NAVY });
    cursor += nameSize * 1.12;
  }
  cursor += m(1);
  if (card.caseNumber) {
    pill(page, left, cursor, m(4.2), card.caseNumber, 7.2, BLUE, [1, 1, 1], m(2.2));
    cursor += m(5.6);
  }
  if (card.carer) {
    const carer = `Carer: ${card.carer.name}${card.carer.relationship ? ` · ${card.carer.relationship}` : ""}`;
    page.text(left, cursor, fitSize(carer, inner, 6.2, false, 4.6), carer, { gray: 0.1 });
    cursor += m(3);
  }
  page.text(left, cursor, 5.2, `Card ${card.version} · Issued ${card.issuedOn}`, { gray: MUTED });

  // What it is used for.
  const gap = m(1.2);
  const box = (inner - gap * 2) / 3;
  ["Admission", "Meals", "Goods"].forEach((label, i) => {
    const bx = left + i * (box + gap);
    page.fillRectRgb(bx, y + m(62.6), box, m(5.6), PALE);
    page.text(bx + box / 2, y + m(64.4), 5.4, label, { bold: true, rgb: BLUE, align: "center" });
  });
  footer(page, x, y);
}

function back(page: PdfPage, x: number, y: number, logo: PdfImage, address: string) {
  const m = (v: number) => v * MM;
  const left = x + m(3.6);
  const inner = m(W - 7.2);
  const logoW = m(24);
  page.image(logo, x + (m(W) - logoW) / 2, y + m(4), logoW, (logoW * logo.height) / logo.width);
  let cursor = y + m(11.6);
  for (const line of ["This card belongs to", "Little Ark Foundation"]) {
    page.text(left, cursor, 8.2, line, { bold: true, rgb: NAVY });
    cursor += 9.6;
  }
  cursor += m(1.4);
  const para = (text: string, size = 5.8, bold = false) => {
    for (const line of wrap(text, inner, size)) {
      page.text(left, cursor, size, line, { gray: 0.1, bold });
      cursor += size * 1.38;
    }
    cursor += m(1.6);
  };
  para("Show it to LAF staff when you arrive at LAF House, at every meal, and when you receive goods. Staff scan the code to find you.");
  const boxLines = wrap("The code holds no personal details. It shows nothing unless an LAF staff member is signed in.", inner - m(4), 5.6);
  const boxH = boxLines.length * 5.6 * 1.38 + m(3);
  page.fillRectRgb(left, cursor, inner, boxH, PALE);
  let by = cursor + m(1.5);
  for (const line of boxLines) {
    page.text(left + m(2), by, 5.6, line, { rgb: NAVY });
    by += 5.6 * 1.38;
  }
  cursor += boxH + m(2.2);
  para("Lost or damaged? Tell the social worker. The old card is switched off and a new one is printed.");
  para(address ? `Found this card? Please return it to LAF House, ${address}.` : "Found this card? Please return it to LAF House.");
  footer(page, x, y);
}

/** A sheet of cards: three a page, each front and back side by side, a dashed fold line between them. */
export async function buildIdCardsPdf(cards: IdCard[], assets: { logo: PdfImage; address: string }): Promise<Buffer> {
  const pages: PdfPage[] = [];
  const m = (v: number) => v * MM;
  const pairW = m(W * 2);
  const x0 = (m(210) - pairW) / 2;
  for (let i = 0; i < cards.length; i += 3) {
    const page = new PdfPage();
    page.text(x0, m(8), 7.5, "LAF Patient ID cards: cut along the outer line, fold on the dashed line, laminate.", { gray: MUTED });
    for (const [slot, card] of cards.slice(i, i + 3).entries()) {
      const y = m(16) + slot * m(H + 8);
      front(page, x0, y, card, await cardQr(card.token), assets.logo);
      back(page, x0 + m(W), y, assets.logo, assets.address);
      page.strokeRect(x0, y, pairW, m(H), 0.62, 0.5);
      page.strokePath([[x0 + m(W), y], [x0 + m(W), y + m(H)]], [0.55, 0.55, 0.55], 0.5, true);
    }
    pages.push(page);
  }
  return buildPdf(pages, "LAF Patient ID cards");
}
