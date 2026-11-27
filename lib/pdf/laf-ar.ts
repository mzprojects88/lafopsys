import { A4, PdfPage, buildPdf, fitSize, textWidth, wrap, type PdfImage } from "./writer.ts";
import { LAF_LOGO_JPEG } from "./laf-logo.ts";

/**
 * The LAF acknowledgement receipt: the foundation's own receipt, numbered by
 * the database in one of four series (0047) -- donated items, used items, new
 * or used fixed assets. Values stay off the page unless the person
 * downloading ticks "Show values", which prints every line's value and the
 * total (LAF, 27 Sep 2026).
 */

export type LafArKind = "gik" | "usd" | "asn" | "aus" | "dtp";

export interface LafArLine {
  id: string;
  name: string;
  quantity: number;
  uom: string;
  /** "Good", "Fair"... -- used items only. */
  condition?: string;
  lineTotal: number;
}

export interface LafArData {
  arNumber: string;
  /** The paper booklet AR given to the donor (0056), printed under the LAF AR number when there is one. */
  bookletArNumber?: string;
  kind: LafArKind;
  /** yyyy-mm-dd */
  date: string;
  donorName: string;
  /** The receiver's full name, from their staff record when known (0061). */
  receivedBy?: string;
  /** Their position (Settings > Staff on receipts), printed under the signature line. */
  receivedByPosition?: string;
  /** The receiver's signature, when they allowed it on gifts-in-kind receipts (Operating System 0153). */
  receivedBySignature?: PdfImage;
  notes?: string;
  /** The registration line (SEC, BIR) from Settings > Receipts & reports. */
  header?: string;
  /** "DSWD Accreditation No. ..." from the Operating System's Settings (lafopsys 0119): under the letterhead and in every page's footer. */
  accreditation?: string;
  lines: LafArLine[];
}

export interface LafArOptions {
  showValues: boolean;
}

const KIND: Record<LafArKind, { subtitle: string; what: string; valueNote: string }> = {
  gik: {
    subtitle: "Donated items (gifts in kind)",
    what: "the following donated items",
    valueNote: "Values are the donor-stated value or LAF's estimate of fair value (local retail price).",
  },
  usd: {
    subtitle: "Donated used items (gifts in kind)",
    what: "the following donated used items",
    valueNote: "Values are estimated fair values of used goods: the brand-new price less an allowance for condition.",
  },
  asn: {
    subtitle: "Donated equipment (fixed assets)",
    what: "the following donated equipment",
    valueNote: "Values are the donor-stated value or LAF's estimate of fair value.",
  },
  dtp: {
    subtitle: "Donated items for the patients (given directly)",
    what: "the following items donated for the patients of Little Ark Foundation",
    valueNote: "Values are the donor-stated value or LAF's estimate of fair value (local retail price).",
  },
  aus: {
    subtitle: "Donated used equipment (fixed assets)",
    what: "the following donated used equipment",
    valueNote: "Values are estimated fair values of used equipment: the brand-new price less an allowance for condition.",
  },
};

/** Which series a receipt belongs to, from the receiving form's Used and Fixed asset ticks. */
export const arKindOf = (used: boolean, asset: boolean): LafArKind => (asset ? (used ? "aus" : "asn") : used ? "usd" : "gik");

const MARGIN = 48;
const INNER = A4.width - MARGIN * 2;
const ROW = 20;
const FIRST_PAGE_ROWS = 18;
const MORE_PAGE_ROWS = 30;
// A continued last page keeps room for the total, signatures (name, line, position) and SALE_NOTE above the footer.
const LAST_PAGE_ROWS = 25;

/** Printed under the signatures on every AR (wording from the user, 2026-10-06). */
export const SALE_NOTE =
  "Note: In cases where donated consumable goods exceed the Foundation’s reasonable program or operational needs, the Foundation may, when appropriate, dispose of such excess goods through sale and use the proceeds exclusively to support its charitable programs and operational requirements, subject to applicable laws, donor restrictions, and Foundation policies.";

const logo: PdfImage = { jpeg: Buffer.from(LAF_LOGO_JPEG.base64, "base64"), width: LAF_LOGO_JPEG.width, height: LAF_LOGO_JPEG.height };

/** Pesos in the base fonts, which have no peso sign. */
export function money(amount: number): string {
  return `PHP ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Fits a cell: shrinks to 7 pt, then cuts with "..." rather than run into the next column. */
function cell(text: string, width: number, size: number, bold = false): { text: string; size: number } {
  const fitted = fitSize(text, width, size, bold, 7);
  if (textWidth(text, fitted, bold) <= width) return { text, size: fitted };
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, fitted, bold) > width) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}...`, size: fitted };
}

/** The pages, laid out; separate from buildLafAr so the layout can be tested. */
export function layoutLafAr(data: LafArData, options: LafArOptions): PdfPage[] {
  const kind = KIND[data.kind];
  const values = options.showValues;
  const conditions = data.lines.some((l) => l.condition);
  const cols = {
    n: 22,
    qty: values ? 46 : 56,
    unit: values ? 56 : 66,
    condition: conditions ? (values ? 74 : 75) : 0,
    value: values ? 95 : 0,
    item: 0,
  };
  cols.item = INNER - cols.n - cols.qty - cols.unit - cols.condition - cols.value;
  const x = {
    n: MARGIN,
    item: MARGIN + cols.n,
    qtyRight: MARGIN + cols.n + cols.item + cols.qty,
    unit: MARGIN + cols.n + cols.item + cols.qty + 10,
    condition: MARGIN + cols.n + cols.item + cols.qty + cols.unit,
    valueRight: MARGIN + INNER,
  };

  const chunks: LafArLine[][] = [];
  for (let i = 0; i < Math.max(data.lines.length, 1); ) {
    const take = chunks.length === 0 ? FIRST_PAGE_ROWS : MORE_PAGE_ROWS;
    chunks.push(data.lines.slice(i, i + take));
    i += take;
  }
  const tail = chunks[chunks.length - 1]!;
  if (chunks.length > 1 && tail.length > LAST_PAGE_ROWS) chunks.push(tail.splice(LAST_PAGE_ROWS));

  return chunks.map((rows, pageIndex) => {
    const page = new PdfPage();
    let y = MARGIN;

    if (pageIndex === 0) {
      const logoWidth = 170;
      page.image(logo, MARGIN, y, logoWidth, (logoWidth * logo.height) / logo.width);
      page.text(MARGIN + INNER, y, 14, "ACKNOWLEDGEMENT RECEIPT", { bold: true, align: "right" });
      page.text(MARGIN + INNER, y + 18, 10, kind.subtitle, { gray: 0.35, align: "right" });
      page.text(MARGIN + INNER, y + 36, 11, `AR No. ${data.arNumber}`, { bold: true, align: "right" });
      if (data.bookletArNumber) {
        // Under the LAF number; the date moves down a line, still above the rule at y + 78.
        page.text(MARGIN + INNER, y + 51, 9, `Booklet AR No. ${data.bookletArNumber}`, { align: "right" });
        page.text(MARGIN + INNER, y + 63, 10, longDate(data.date), { gray: 0.35, align: "right" });
      } else {
        page.text(MARGIN + INNER, y + 52, 10, longDate(data.date), { gray: 0.35, align: "right" });
      }
      page.text(MARGIN, y + 40, 9, "Little Ark Foundation, Inc.", { gray: 0.35 });
      if (data.header) {
        // Registration numbers print in full: wrapped onto a second line, cut only past that.
        const width = INNER / 2 + 20;
        const words = data.header.split(" ");
        let first = "";
        while (words.length && textWidth(`${first} ${words[0]}`.trim(), 7.5) <= width) first = `${first} ${words.shift()}`.trim();
        page.text(MARGIN, y + 52, 7.5, first, { gray: 0.45 });
        if (words.length) {
          const rest = cell(words.join(" "), width, 7.5);
          page.text(MARGIN, y + 62, rest.size, rest.text, { gray: 0.45 });
        }
      }
      if (data.accreditation) {
        const headerLines = !data.header ? 0 : textWidth(data.header, 7.5) <= INNER / 2 + 20 ? 1 : 2;
        const acc = cell(data.accreditation, INNER / 2 + 20, 8, true);
        page.text(MARGIN, y + 52 + headerLines * 9, acc.size, acc.text, { bold: true, gray: 0.2 });
      }
      y += 78;
      page.fillRect(MARGIN, y, INNER, 0.75, 0.8);
      y += 16;
      page.text(MARGIN, y, 9, "Received from", { gray: 0.35 });
      page.text(MARGIN, y + 13, 13, data.donorName, { bold: true });
      y += 38;
      page.text(MARGIN, y, 10, `Little Ark Foundation, Inc. gratefully acknowledges receipt of ${kind.what}:`);
      y += 24;
    } else {
      page.text(MARGIN, y, 11, `AR No. ${data.arNumber} (continued)`, { bold: true });
      y += 26;
    }

    // Column heads.
    page.fillRect(MARGIN, y, INNER, ROW, 0.95);
    const head = (value: string, at: number, align: "left" | "right" = "left") => page.text(at, y + 6, 8.5, value, { bold: true, gray: 0.3, align });
    head("#", x.n + 4);
    head("Item", x.item);
    head("Qty", x.qtyRight, "right");
    head("Unit", x.unit);
    if (conditions) head("Condition", x.condition);
    if (values) head("Value", x.valueRight - 4, "right");
    y += ROW;

    rows.forEach((line, i) => {
      const number = (chunks.slice(0, pageIndex).reduce((n, c) => n + c.length, 0) + i + 1).toString();
      page.text(x.n + 4, y + 6, 9, number, { gray: 0.4 });
      const name = cell(line.name, cols.item - 8, 9);
      page.text(x.item, y + 6, name.size, name.text);
      page.text(x.qtyRight, y + 6, 9, String(line.quantity), { align: "right" });
      const unit = cell(line.uom, cols.unit - 12, 9);
      page.text(x.unit, y + 6, unit.size, unit.text);
      if (conditions) page.text(x.condition, y + 6, 9, line.condition ?? "");
      if (values) page.text(x.valueRight - 4, y + 6, 9, money(line.lineTotal), { align: "right" });
      y += ROW;
      page.fillRect(MARGIN, y, INNER, 0.5, 0.88);
    });

    const last = pageIndex === chunks.length - 1;
    if (last) {
      y += 8;
      if (values) {
        const total = data.lines.reduce((sum, l) => sum + l.lineTotal, 0);
        page.text(x.valueRight - 4 - 110, y + 2, 10, "Total value", { bold: true, align: "right" });
        page.text(x.valueRight - 4, y + 2, 10, money(Math.round(total * 100) / 100), { bold: true, align: "right" });
        y += 22;
        page.text(MARGIN, y, 8, kind.valueNote, { gray: 0.4 });
        y += 16;
      }
      if (data.notes) {
        const note = cell(`Notes: ${data.notes}`, INNER, 9);
        page.text(MARGIN, y, note.size, note.text, { gray: 0.25 });
        y += 18;
      }

      // Signatures, kept to the lower part of the page.
      const signY = Math.max(y + 60, A4.height - MARGIN - 122);
      const half = (INNER - 40) / 2;
      page.signature(data.receivedBySignature, MARGIN, signY - 16, half);
      page.text(MARGIN, signY - 16, 10, data.receivedBy ?? "");
      page.fillRect(MARGIN, signY, half, 0.75, 0.3);
      // Under the line: the receiver's position (0061), then what the signature stands for.
      let captionY = signY + 6;
      if (data.receivedByPosition) {
        page.text(MARGIN, captionY, 8.5, data.receivedByPosition, { gray: 0.15 });
        captionY += 11;
      }
      page.text(MARGIN, captionY, 8.5, "Received for Little Ark Foundation, Inc.", { gray: 0.35 });
      // The donor's name over their line too, as the receiver's is over LAF's; an anonymous gift leaves it blank.
      if (!/^anonymous( donor)?$/i.test(data.donorName.trim())) {
        const donor = cell(data.donorName, half, 10);
        page.text(MARGIN + half + 40, signY - 16, donor.size, donor.text);
      }
      page.fillRect(MARGIN + half + 40, signY, half, 0.75, 0.3);
      page.text(MARGIN + half + 40, signY + 6, 8.5, "Donor or representative", { gray: 0.35 });
      wrap(SALE_NOTE, INNER, 7.5).forEach((line, i) => page.text(MARGIN, signY + 40 + i * 10, 7.5, line, { gray: 0.4 }));
    }

    if (data.accreditation) page.text(A4.width / 2, A4.height - MARGIN + 1, 7.5, data.accreditation, { gray: 0.35, align: "center" });
    page.text(A4.width / 2, A4.height - MARGIN + 12, 8, `${data.arNumber} - Page ${pageIndex + 1} of ${chunks.length}`, { gray: 0.5, align: "center" });
    return page;
  });
}

export function buildLafAr(data: LafArData, options: LafArOptions): Buffer {
  return buildPdf(layoutLafAr(data, options), `LAF acknowledgement receipt ${data.arNumber}`);
}
