// NCH Cancer Assistance Fund billing package (0098), in the order LAF sends it: the Billing
// Statement, then for each child a Statement of Account and an Endorsement Letter (LAF copy and
// NCH copy on one page). The figures come from lib/utils/caf.ts; nothing is computed here.
// Relative, with extensions, so node --test can load the layout without a bundler.
import { A4, PdfPage, buildPdf, fitSize, wrap } from "./writer.ts";
import { drawLetterhead } from "./cash-ar.ts";
import { cafAmounts, cafDay, cafMonthLabel, cafPeriod, cafTotals, pesosInWords, type CafTerms } from "../utils/caf.ts";

export interface CafChild {
  name: string;
  age: number | null;
  diagnosis: string;
  nights: string[];
  pwd: boolean;
}

export interface CafPackage {
  month: string;
  /** The bill's date (when it was made final), yyyy-mm-dd. */
  invoiceDate: string;
  terms: CafTerms;
  children: CafChild[];
  program: string;
  payerName: string;
  payerAddress: string;
  bank: { name: string; accountName: string; accountNo: string; accountType: string };
  preparedBy?: { name: string; title?: string };
  approvedBy?: { name: string; title?: string };
  nchLetterhead: string[];
  /** The registration line (SEC, BIR, DSWD) from Settings. */
  header?: string;
  orgAddress?: string;
  /** Only the Statement and Letter for one child, no Billing Statement. */
  onlyChild?: boolean;
  /** Not final yet: every page says DRAFT. */
  draft?: boolean;
}

const MARGIN = 48;
const INNER = A4.width - MARGIN * 2;
const peso = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
const slashDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;

function title(page: PdfPage, y: number, data: CafPackage, second: string) {
  drawLetterhead(page, y, data.header);
  page.text(MARGIN + INNER, y + 4, 13, data.program, { bold: true, align: "right" });
  page.text(MARGIN + INNER, y + 22, 13, second, { bold: true, align: "right" });
}

function addressee(page: PdfPage, y: number, data: CafPackage, dateLabel: string, date: string, due?: string) {
  page.text(MARGIN, y, 8.5, "TO:", { gray: 0.35 });
  page.text(MARGIN + 60, y, 8.5, data.payerName, { bold: true });
  page.text(MARGIN, y + 12, 8.5, "ADDRESS:", { gray: 0.35 });
  page.text(MARGIN + 60, y + 12, 8.5, data.payerAddress);
  page.text(MARGIN + INNER - 150, y, 8.5, dateLabel, { gray: 0.35 });
  page.text(MARGIN + INNER, y, 8.5, date, { align: "right" });
  if (due) {
    page.text(MARGIN + INNER - 150, y + 12, 8.5, "Due Date:", { gray: 0.35 });
    page.text(MARGIN + INNER, y + 12, 8.5, due, { align: "right" });
  }
}

function signatures(page: PdfPage, y: number, data: CafPackage) {
  const half = (INNER - 40) / 2;
  const sign = (x: number, label: string, who?: { name: string; title?: string }) => {
    page.text(x, y, 8.5, label, { gray: 0.35 });
    page.text(x + half / 2, y + 28, 9.5, who?.name ?? "", { align: "center" });
    page.fillRect(x, y + 41, half, 0.6, 0.3);
    if (who?.title) page.text(x + half / 2, y + 45, 8, who.title, { align: "center", gray: 0.25 });
  };
  sign(MARGIN, "Prepared By:", data.preparedBy);
  sign(MARGIN + half + 40, "Approved By:", data.approvedBy);
}

/** The month's summary: one row per child, the totals, the amount in words, where to pay. */
function billingStatement(data: CafPackage): PdfPage[] {
  const pages: PdfPage[] = [];
  // x + w is each figure column's right edge; the last one ends at the margin.
  const cols = [
    { label: "PATIENT'S NAME", x: MARGIN, w: 175, align: "left" as const },
    { label: "# of Stays", x: MARGIN + 175, w: 45, align: "right" as const },
    { label: "Billable|Stay", x: MARGIN + 232, w: 45, align: "right" as const },
    { label: "Rate/Stay", x: MARGIN + 290, w: 50, align: "right" as const },
    { label: "Gross|Amount", x: MARGIN + 355, w: 55, align: "right" as const },
    { label: `Less ${data.terms.discountPct}%|PWD Discount`, x: MARGIN + INNER - 40, w: 40, align: "right" as const },
  ];
  const ROW = 13;
  let page = new PdfPage();
  let y = MARGIN;
  const head = () => {
    title(page, y, data, `Billing Statement - ${cafMonthLabel(data.month)}`);
    y += 78;
    addressee(page, y, data, "Invoice Date:", slashDate(data.invoiceDate), slashDate(data.invoiceDate));
    y += 32;
    page.fillRect(MARGIN, y, INNER, 0.75, 0.6);
    y += 6;
    // Two-line headings, as the package prints them ("Gross / Amount").
    cols.forEach((c) =>
      c.label.split("|").forEach((part, i) => page.text(c.align === "right" ? c.x + c.w : c.x, y + i * 9, 8, part, { bold: true, align: c.align === "right" ? "right" : "left" }))
    );
    y += 24;
  };
  head();
  const totals = cafTotals(data.children, data.terms);
  for (const child of data.children) {
    if (y > A4.height - MARGIN - 220) {
      pages.push(page);
      page = new PdfPage();
      y = MARGIN;
      head();
    }
    const a = cafAmounts(child, data.terms);
    const cells = [child.name, a.stays.toFixed(2), a.billable.toFixed(2), peso(data.terms.rate), peso(a.gross), peso(a.net)];
    cells.forEach((v, i) => {
      const c = cols[i]!;
      const text = i === 0 ? v.toUpperCase() : v;
      // A long name shrinks to its column instead of running into the figures.
      page.text(c.align === "right" ? c.x + c.w : c.x, y, i === 0 ? fitSize(text, c.w - 8, 8.5) : 8.5, text, { align: c.align === "right" ? "right" : "left" });
    });
    y += ROW;
  }
  page.fillRect(MARGIN + 175, y, INNER - 175, 0.6, 0.3);
  y += 5;
  [String(totals.stays.toFixed(2)), totals.billable.toFixed(2), "", peso(totals.gross), peso(totals.net)].forEach((v, i) => {
    const c = cols[i + 1]!;
    if (v) page.text(c.x + c.w, y, 8.5, v, { bold: true, align: "right" });
  });
  y += 26;
  page.text(MARGIN, y, 11, "TOTAL AMOUNT DUE", { bold: true });
  page.text(MARGIN + INNER, y, 11, peso(totals.net), { bold: true, align: "right" });
  y += 16;
  wrap(`Amount in words: ${pesosInWords(totals.net)}`, INNER, 8.5).forEach((line) => {
    page.text(MARGIN, y, 8.5, line, { bold: true });
    y += 11;
  });
  y += 10;
  page.fillRect(MARGIN, y, INNER, 0.6, 0.6);
  y += 8;
  page.text(MARGIN, y, 8.5, `Please deposit payment to ${data.bank.name} with the following details:`, { bold: true });
  page.text(MARGIN, y + 12, 8.5, `Account Name: ${data.bank.accountName}`);
  page.text(MARGIN, y + 24, 8.5, `${data.bank.accountType} Acct Number: ${data.bank.accountNo || "-"}`);
  signatures(page, Math.max(y + 52, A4.height - MARGIN - 70), data);
  pages.push(page);
  return pages;
}

/** One child's month: the figures and the nights stayed. */
function statementOfAccount(data: CafPackage, child: CafChild): PdfPage {
  const page = new PdfPage();
  let y = MARGIN;
  title(page, y, data, "Statement of Account");
  y += 78;
  addressee(page, y, data, "Date:", slashDate(data.invoiceDate));
  y += 48;
  const a = cafAmounts(child, data.terms);
  const left = MARGIN + 110;
  const right = MARGIN + INNER - 110;
  const row = (label: string, value: string, bold = false) => {
    page.text(left, y, 9.5, label);
    page.text(right, y, 9.5, value, { align: "right", bold });
    y += 14;
  };
  row("Patient Name:", child.name, true);
  row("Period:", cafPeriod(data.month));
  row("Total No. of Stays:", a.stays.toFixed(2));
  row("Billable Stay", a.billable.toFixed(2));
  row("Rate per Stay", peso(data.terms.rate));
  row("Gross Amount", peso(a.gross));
  row("PWD Discount", `${a.discountPct}%`);
  page.fillRect(left, y, right - left, 0.75, 0.2);
  y += 4;
  page.text(left, y, 8.5, "Total Amount Due:", { bold: true });
  page.text(right, y, 8.5, peso(a.net), { bold: true, align: "right" });
  y += 30;
  page.text(left, y, 9, "Days Stayed at LAF:");
  y += 13;
  for (const night of a.billableNights) {
    page.text(left + 40, y, 9, cafDay(night));
    y += 12;
  }
  signatures(page, A4.height - MARGIN - 70, data);
  return page;
}

/** NCH's endorsement, LAF copy above and NCH copy below, for the three signatures. */
function endorsementLetter(data: CafPackage, child: CafChild): PdfPage {
  const page = new PdfPage();
  const a = cafAmounts(child, data.terms);
  const half = (A4.height - MARGIN * 2) / 2;
  const copy = (top: number, label: string) => {
    let y = top;
    data.nchLetterhead.forEach((line, i) => {
      page.text(A4.width / 2, y, i === 2 || i === 3 ? 8.5 : 8, line, { align: "center", bold: i === 2 || i === 3 });
      y += 10;
    });
    page.text(MARGIN + INNER, top, 8.5, label, { align: "right", gray: 0.25 });
    y += 6;
    page.text(MARGIN, y, 9, `Date: ${shortDate(data.invoiceDate)}`);
    page.text(A4.width / 2, y, 10, "E N D O R S E M E N T   L E T T E R", { align: "center" });
    y += 16;
    const ageText = child.age == null ? "" : `, ${child.age} years old`;
    const body =
      `This is to certify that ${child.name}${ageText}, diagnosed with ${child.diagnosis || "cancer"}, availed of temporary housing ` +
      `accommodation on the dates listed below at PHP ${peso(data.terms.rate)} (${pesosInWords(data.terms.rate)}) per stay.` +
      (a.discountPct ? ` After the ${a.discountPct}% PWD discount, the total amount payable is` : " The total amount payable is") +
      ` PHP ${peso(a.net)} (${pesosInWords(a.net)}), charged under the Cancer Assistance Fund to Little Ark Foundation, Inc.`;
    wrap(body, INNER, 8.5).forEach((line) => {
      page.text(MARGIN, y, 8.5, line);
      y += 11;
    });
    y += 4;
    const tableTop = y;
    const tableHeight = top + half - 14 - tableTop;
    const colX = [MARGIN, MARGIN + 85, MARGIN + 210, MARGIN + 345, MARGIN + INNER];
    page.strokeRect(MARGIN, tableTop, INNER, tableHeight, 0.2, 0.6);
    for (const x of colX.slice(1, -1)) page.fillRect(x, tableTop, 0.6, tableHeight, 0.2);
    page.text(colX[0]! + 6, tableTop + 4, 7.5, "Date(s) of Stay", { bold: true });
    ["Verified by:", "Verified by:", "Verified by:"].forEach((t, i) => page.text(colX[i + 1]! + 6, tableTop + 4, 7.5, t, { bold: true }));
    a.billableNights.forEach((night, i) => page.text(colX[0]! + 14, tableTop + 18 + i * 10, 8, cafDay(night)));
    ["LAF Social Worker", "Patient Navigator", "Medical Social Worker"].forEach((t, i) =>
      page.text((colX[i + 1]! + colX[i + 2]!) / 2, tableTop + tableHeight - 16, 7.5, t, { align: "center", bold: true })
    );
  };
  copy(MARGIN, "LAF COPY");
  page.fillRect(MARGIN, MARGIN + half - 4, INNER, 0.4, 0.75);
  copy(MARGIN + half + 6, "NCH COPY");
  return page;
}

export function layoutCafPackage(data: CafPackage): PdfPage[] {
  const pages = data.onlyChild ? [] : billingStatement(data);
  for (const child of data.children) pages.push(statementOfAccount(data, child), endorsementLetter(data, child));
  if (data.draft) pages.forEach((p) => p.text(A4.width / 2, 18, 9, "DRAFT - not final, do not send", { align: "center", bold: true, gray: 0.45 }));
  return pages;
}

export function buildCafPackage(data: CafPackage): Buffer {
  return buildPdf(layoutCafPackage(data), `NCH CAF billing ${cafMonthLabel(data.month)}`);
}
