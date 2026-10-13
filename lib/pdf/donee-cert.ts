import { A4, PdfPage, buildPdf, fitSize, textWidth, wrap } from "./writer.ts";
import { drawLetterhead, longDate, money } from "./cash-ar.ts";

/**
 * Certificate of Donation (BIR Form 2322) issued by the donee (0085): the donee's and the
 * donor's name, address and TIN, the date, what was donated (a cash amount, or the items of a
 * gift in kind with their values) and the signature of the foundation's authorised
 * representative. Control-numbered by the database (DC-YYYY-NNNN).
 */
export interface DoneeCertLine {
  name: string;
  quantity: number;
  uom: string;
  value: number;
}

export interface DoneeCertData {
  controlNumber: string;
  /** yyyy-mm-dd of the donation */
  date: string;
  kind: "cash" | "in_kind";
  amount: number;
  currency: "PHP" | "USD";
  donorName: string;
  donorAddress?: string;
  donorTin?: string;
  /** Accounting's / Inventory's receipt number for the same gift, as reference. */
  receiptNumber?: string;
  lines: DoneeCertLine[];
  orgAddress?: string;
  orgTin?: string;
  header?: string;
  signatoryName?: string;
  signatoryPosition?: string;
}

const MARGIN = 48;
const INNER = A4.width - MARGIN * 2;
const ROW = 18;
const FIRST_PAGE_ROWS = 14;
const MORE_PAGE_ROWS = 32;
const LAST_PAGE_ROWS = 24;

function cell(text: string, width: number, size: number, bold = false): { text: string; size: number } {
  const fitted = fitSize(text, width, size, bold, 7);
  if (textWidth(text, fitted, bold) <= width) return { text, size: fitted };
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, fitted, bold) > width) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}...`, size: fitted };
}

export function layoutDoneeCert(data: DoneeCertData): PdfPage[] {
  const lines = data.kind === "in_kind" ? data.lines : [];
  const chunks: DoneeCertLine[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); ) {
    const take = chunks.length === 0 ? FIRST_PAGE_ROWS : MORE_PAGE_ROWS;
    chunks.push(lines.slice(i, i + take));
    i += take;
  }
  const tail = chunks[chunks.length - 1]!;
  if (chunks.length > 1 && tail.length > LAST_PAGE_ROWS) chunks.push(tail.splice(LAST_PAGE_ROWS));

  return chunks.map((rows, pageIndex) => {
    const page = new PdfPage();
    let y = MARGIN;
    if (pageIndex === 0) {
      drawLetterhead(page, y, data.header);
      page.text(MARGIN + INNER, y, 14, "CERTIFICATE OF DONATION", { bold: true, align: "right" });
      page.text(MARGIN + INNER, y + 18, 10, "BIR Form 2322", { gray: 0.35, align: "right" });
      page.text(MARGIN + INNER, y + 36, 11, `Control No. ${data.controlNumber}`, { bold: true, align: "right" });
      page.text(MARGIN + INNER, y + 52, 10, longDate(data.date), { gray: 0.35, align: "right" });
      y += 78;
      page.fillRect(MARGIN, y, INNER, 0.75, 0.8);
      y += 16;

      // Donee and donor, side by side.
      const half = (INNER - 24) / 2;
      const party = (x: number, title: string, name: string, address: string | undefined, tin: string | undefined) => {
        page.text(x, y, 9, title, { gray: 0.35 });
        const n = cell(name, half, 11, true);
        page.text(x, y + 13, n.size, n.text, { bold: true });
        const addr = wrap(address || "Address not on file", half, 8.5).slice(0, 2);
        addr.forEach((line, i) => page.text(x, y + 29 + i * 11, 8.5, line, { gray: address ? 0.2 : 0.5 }));
        page.text(x, y + 29 + addr.length * 11, 8.5, `TIN ${tin || "—"}`, { gray: 0.2 });
      };
      party(MARGIN, "Donee", "Little Ark Foundation, Inc.", data.orgAddress, data.orgTin);
      party(MARGIN + half + 24, "Donor", data.donorName, data.donorAddress, data.donorTin);
      y += 72;
      page.text(MARGIN, y, 10, `This certifies that on ${longDate(data.date)} the donee received from the donor ${data.kind === "cash" ? "the cash donation of" : "the donation in kind of"}`);
      y += 18;
      if (data.kind === "cash") {
        page.text(MARGIN, y, 13, money(data.amount, data.currency), { bold: true });
        y += 24;
      }
      if (data.receiptNumber) {
        page.text(MARGIN, y, 9, `Acknowledged by receipt No. ${data.receiptNumber}.`, { gray: 0.35 });
        y += 16;
      }
    } else {
      page.text(MARGIN, y, 11, `Control No. ${data.controlNumber} (continued)`, { bold: true });
      y += 26;
    }

    if (data.kind === "in_kind") {
      const cols = { n: 22, qty: 50, unit: 60, value: 95 };
      const item = INNER - cols.n - cols.qty - cols.unit - cols.value;
      const x = { n: MARGIN, item: MARGIN + cols.n, qtyRight: MARGIN + cols.n + item + cols.qty, unit: MARGIN + cols.n + item + cols.qty + 10, valueRight: MARGIN + INNER };
      page.fillRect(MARGIN, y, INNER, ROW, 0.95);
      const head = (value: string, at: number, align: "left" | "right" = "left") => page.text(at, y + 5, 8.5, value, { bold: true, gray: 0.3, align });
      head("#", x.n + 4);
      head("Item", x.item);
      head("Qty", x.qtyRight, "right");
      head("Unit", x.unit);
      head("Value", x.valueRight - 4, "right");
      y += ROW;
      rows.forEach((line, i) => {
        const number = (chunks.slice(0, pageIndex).reduce((n, c) => n + c.length, 0) + i + 1).toString();
        page.text(x.n + 4, y + 5, 9, number, { gray: 0.4 });
        const name = cell(line.name, item - 8, 9);
        page.text(x.item, y + 5, name.size, name.text);
        page.text(x.qtyRight, y + 5, 9, String(line.quantity), { align: "right" });
        const unit = cell(line.uom, cols.unit - 12, 9);
        page.text(x.unit, y + 5, unit.size, unit.text);
        page.text(x.valueRight - 4, y + 5, 9, money(line.value, data.currency), { align: "right" });
        y += ROW;
        page.fillRect(MARGIN, y, INNER, 0.5, 0.88);
      });
    }

    const last = pageIndex === chunks.length - 1;
    if (last) {
      if (data.kind === "in_kind") {
        y += 6;
        page.text(MARGIN + INNER - 4 - 110, y + 2, 10, "Total value", { bold: true, align: "right" });
        page.text(MARGIN + INNER - 4, y + 2, 10, money(data.amount, data.currency), { bold: true, align: "right" });
        y += 22;
        page.text(MARGIN, y, 8, "Values are the donor-stated value or the donee's estimate of fair value.", { gray: 0.4 });
        y += 16;
      }
      y += 8;
      wrap("Issued in compliance with Revenue Regulations No. 13-98 for the donor's records. The donee is a non-stock, non-profit organisation; this certificate does not by itself establish the deductibility of the donation.", INNER, 8).forEach((line) => {
        page.text(MARGIN, y, 8, line, { gray: 0.4 });
        y += 11;
      });
      const signY = Math.max(y + 70, A4.height - MARGIN - 100);
      const half = (INNER - 40) / 2;
      page.text(MARGIN, signY - 16, 10, data.signatoryName ?? "");
      page.fillRect(MARGIN, signY, half, 0.75, 0.3);
      let captionY = signY + 6;
      if (data.signatoryPosition) {
        page.text(MARGIN, captionY, 8.5, data.signatoryPosition, { gray: 0.15 });
        captionY += 11;
      }
      page.text(MARGIN, captionY, 8.5, "Authorised representative, Little Ark Foundation, Inc.", { gray: 0.35 });
      page.text(MARGIN + half + 40, signY + 6, 8.5, "Date signed: ____________________", { gray: 0.35 });
    }
    page.text(A4.width / 2, A4.height - MARGIN + 12, 8, `${data.controlNumber} - Page ${pageIndex + 1} of ${chunks.length}`, { gray: 0.5, align: "center" });
    return page;
  });
}

export function buildDoneeCert(data: DoneeCertData): Buffer {
  return buildPdf(layoutDoneeCert(data), `Certificate of donation ${data.controlNumber}`);
}
