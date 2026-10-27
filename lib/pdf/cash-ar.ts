// Relative, with extensions, so node --test can load the layout without a bundler.
import { A4, PdfPage, buildPdf, fitSize, textWidth, wrap, type PdfImage } from "./writer.ts";
import { LAF_LOGO_JPEG } from "./laf-logo.ts";
import { amountInWords } from "../utils/amount-words.ts";

/**
 * The LAF acknowledgement receipt for a CASH gift (0085), numbered by the database
 * (LAF-CSH-YYYY-NNNN). Same face as LAF Inventory's receipt for goods: logo, number, the
 * registration line, the donor, then the amount in words and figures, how it was paid and
 * accounting's booklet number as reference, and the two signature lines.
 */
export interface CashArData {
  arNumber: string;
  /** Accounting's paper AR / service invoice number, printed as reference when known. */
  bookletNumber?: string;
  /** yyyy-mm-dd */
  date: string;
  donorName: string;
  amount: number;
  currency: "PHP" | "USD";
  paymentMethod?: string;
  campaign?: string;
  notes?: string;
  /** The signed-in issuer's full name and position, from their staff record. */
  receivedBy?: string;
  receivedByPosition?: string;
  /** The registration line (SEC, BIR, DSWD) from Settings. */
  header?: string;
  /** "DSWD Accreditation No. ..." (0119): under the letterhead and in the footer. */
  accreditation?: string;
}

const MARGIN = 48;
const INNER = A4.width - MARGIN * 2;
const logo: PdfImage = { jpeg: Buffer.from(LAF_LOGO_JPEG.base64, "base64"), width: LAF_LOGO_JPEG.width, height: LAF_LOGO_JPEG.height };

/** Money in the base fonts, which have no peso sign. */
export function money(amount: number, currency: "PHP" | "USD" = "PHP"): string {
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export const PAYMENT_LABEL: Record<string, string> = { cash: "Cash", check: "Check", bank_transfer: "Bank transfer", gcash: "GCash", instapay: "InstaPay", other: "Other" };

/** The foundation's name and registration line at the top left; shared with the certificate. */
export function drawLetterhead(page: PdfPage, y: number, header?: string, accreditation?: string) {
  const logoWidth = 170;
  page.image(logo, MARGIN, y, logoWidth, (logoWidth * logo.height) / logo.width);
  page.text(MARGIN, y + 40, 9, "Little Ark Foundation, Inc.", { gray: 0.35 });
  if (header) {
    const width = INNER / 2 + 20;
    const words = header.split(" ");
    let first = "";
    while (words.length && textWidth(`${first} ${words[0]}`.trim(), 7.5) <= width) first = `${first} ${words.shift()}`.trim();
    page.text(MARGIN, y + 52, 7.5, first, { gray: 0.45 });
    if (words.length) page.text(MARGIN, y + 62, 7.5, wrap(words.join(" "), width, 7.5)[0] ?? "", { gray: 0.45 });
  }
  // An AR's "DSWD Accreditation No. ..." (0119), on its own line under the registration line.
  if (accreditation) {
    const lines = !header ? 0 : textWidth(header, 7.5) <= INNER / 2 + 20 ? 1 : 2;
    page.text(MARGIN, y + 52 + lines * 9, 8, accreditation, { bold: true, gray: 0.2 });
  }
}

/** One page, laid out; separate from buildCashAr so the layout can be tested. */
export function layoutCashAr(data: CashArData): PdfPage[] {
  const page = new PdfPage();
  let y = MARGIN;
  drawLetterhead(page, y, data.header, data.accreditation);
  page.text(MARGIN + INNER, y, 14, "ACKNOWLEDGEMENT RECEIPT", { bold: true, align: "right" });
  page.text(MARGIN + INNER, y + 18, 10, "Cash donation", { gray: 0.35, align: "right" });
  page.text(MARGIN + INNER, y + 36, 11, `AR No. ${data.arNumber}`, { bold: true, align: "right" });
  if (data.bookletNumber) {
    page.text(MARGIN + INNER, y + 51, 9, `Booklet AR No. ${data.bookletNumber}`, { align: "right" });
    page.text(MARGIN + INNER, y + 63, 10, longDate(data.date), { gray: 0.35, align: "right" });
  } else {
    page.text(MARGIN + INNER, y + 52, 10, longDate(data.date), { gray: 0.35, align: "right" });
  }
  y += 78;
  page.fillRect(MARGIN, y, INNER, 0.75, 0.8);
  y += 16;
  page.text(MARGIN, y, 9, "Received from", { gray: 0.35 });
  page.text(MARGIN, y + 13, 13, data.donorName, { bold: true });
  y += 38;
  page.text(MARGIN, y, 10, "Little Ark Foundation, Inc. gratefully acknowledges receipt of the amount of");
  y += 20;
  // The amount: in words, then in figures, boxed.
  const words = wrap(amountInWords(data.amount, data.currency), INNER - 16, 12);
  page.fillRect(MARGIN, y, INNER, 16 * words.length + 36, 0.96);
  words.forEach((line, i) => page.text(MARGIN + 8, y + 8 + i * 16, 12, line, { bold: true }));
  page.text(MARGIN + 8, y + 12 + words.length * 16, 11, money(data.amount, data.currency), { bold: true });
  y += 16 * words.length + 36 + 18;
  const row = (label: string, value: string) => {
    page.text(MARGIN, y, 9, label, { gray: 0.35 });
    page.text(MARGIN + 110, y, 10, value);
    y += 16;
  };
  row("Paid by", data.paymentMethod ? (PAYMENT_LABEL[data.paymentMethod] ?? data.paymentMethod) : "—");
  if (data.campaign) row("Campaign", data.campaign);
  if (data.notes) {
    const lines = wrap(`Notes: ${data.notes}`, INNER, 9);
    lines.forEach((line) => {
      page.text(MARGIN, y, 9, line, { gray: 0.25 });
      y += 12;
    });
  }
  y += 10;
  page.text(MARGIN, y, 9, "This receipt is issued for a donation; no goods or services were provided in exchange.", { gray: 0.4 });

  // Signatures, kept to the lower part of the page.
  const signY = Math.max(y + 70, A4.height - MARGIN - 110);
  const half = (INNER - 40) / 2;
  page.text(MARGIN, signY - 16, 10, data.receivedBy ?? "");
  page.fillRect(MARGIN, signY, half, 0.75, 0.3);
  let captionY = signY + 6;
  if (data.receivedByPosition) {
    page.text(MARGIN, captionY, 8.5, data.receivedByPosition, { gray: 0.15 });
    captionY += 11;
  }
  page.text(MARGIN, captionY, 8.5, "Received for Little Ark Foundation, Inc.", { gray: 0.35 });
  // The donor's name over their line too, as the receiver's is over LAF's; an anonymous gift leaves it blank.
  if (!/^anonymous( donor)?$/i.test(data.donorName.trim())) {
    const size = fitSize(data.donorName, half, 10, false, 7);
    let name = data.donorName;
    while (name.length > 1 && textWidth(name, size) > half) name = `${name.slice(0, -4).trimEnd()}...`;
    page.text(MARGIN + half + 40, signY - 16, size, name);
  }
  page.fillRect(MARGIN + half + 40, signY, half, 0.75, 0.3);
  page.text(MARGIN + half + 40, signY + 6, 8.5, "Donor or representative", { gray: 0.35 });
  if (data.accreditation) page.text(A4.width / 2, A4.height - MARGIN + 1, 7.5, data.accreditation, { gray: 0.35, align: "center" });
  page.text(A4.width / 2, A4.height - MARGIN + 12, 8, `${data.arNumber} - Page 1 of 1`, { gray: 0.5, align: "center" });
  return [page];
}

export function buildCashAr(data: CashArData): Buffer {
  return buildPdf(layoutCashAr(data), `LAF acknowledgement receipt ${data.arNumber}`);
}
