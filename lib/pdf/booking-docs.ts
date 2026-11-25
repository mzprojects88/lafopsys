// Relative, with extensions, so node --test can load the layouts without a bundler.
import { A4, PdfPage, buildPdf, fitSize, textWidth, wrap, type Rgb } from "./writer.ts";
import { drawLetterhead } from "./cash-ar.ts";
import { qrRects } from "./id-card.ts";
import { formatTime12 } from "../utils/time12.ts";
import { durationLabel, monthCover, monthName } from "../utils/booking.ts";
import { longDate } from "../utils/booking-emails.ts";

/**
 * The two printed documents of LAF Activity Center Bookings (0172):
 *  - Booking Details: one approved booking on a page, for the volunteers or the social worker to print and hand
 *    to the guard at National Children's Hospital (who is coming, when, where, what they will do, who at LAF to
 *    call), with a QR code to the booking's live status.
 *  - Activity Plan: a month's proposed activities for a place, from the 1st to the last day of the month, for
 *    NCH to approve and sign.
 * Layouts are separate from the builders so they can be tested and previewed.
 */

const MARGIN = 48;
const INNER = A4.width - MARGIN * 2;
const NAVY: Rgb = [8 / 255, 47 / 255, 89 / 255];
const BLUE: Rgb = [0, 104 / 255, 201 / 255];
const SKY: Rgb = [237 / 255, 248 / 255, 255 / 255];
const SLATE = 0.38;

export interface QrCode {
  pixels: ArrayLike<number>;
  columns: number;
  rows: number;
}

export interface BookingDetailsData {
  ref: string;
  seqNo: string;
  statusLabel: string;
  /** `yyyy-MM-dd`. */
  date: string;
  start: string;
  end: string;
  placeName: string;
  whereToGo: string;
  requestorName: string;
  requestorKind: string;
  contactPerson: string;
  volunteersCount: number;
  hasMinors: boolean;
  names: string[];
  items: { start: string; end: string; activity: string; participants: string; materials: string }[];
  placeInstructions: string;
  bookingInstructions: string;
  coordinatorName: string;
  coordinatorPhone: string;
  /** "Nov 25, 2026, 9:40 PM": when this copy was made. */
  printedAt: string;
  trackUrl: string;
}

/** Wrapped text, top-down; returns the y after the last line. */
function paragraph(page: PdfPage, x: number, y: number, width: number, size: number, text: string, options: { gray?: number; rgb?: Rgb; bold?: boolean; leading?: number; max?: number } = {}): number {
  const { leading = size * 1.35, max = 99, ...draw } = options;
  const all = text.split(/\r?\n/).flatMap((line) => (line.trim() ? wrap(line.trim(), width, size) : []));
  const lines = all.length > max ? [...all.slice(0, max - 1), `${all[max - 1].replace(/[\s.,;:]+$/, "")}…`] : all;
  for (const line of lines) {
    page.text(x, y, size, line, draw);
    y += leading;
  }
  return y;
}

const label = (page: PdfPage, x: number, y: number, text: string) => page.text(x, y, 7.5, text.toUpperCase(), { bold: true, rgb: BLUE });

/** The heading every page of both documents carries: logo left, the document's name right. */
function heading(page: PdfPage, over: string, title: string, lines: string[]): number {
  drawLetterhead(page, MARGIN);
  page.text(MARGIN + INNER, MARGIN, 8, over.toUpperCase(), { bold: true, rgb: BLUE, align: "right" });
  page.text(MARGIN + INNER, MARGIN + 12, 16, title.toUpperCase(), { bold: true, rgb: NAVY, align: "right" });
  lines.forEach((line, i) => page.text(MARGIN + INNER, MARGIN + 34 + i * 12, i ? 8.5 : 10, line, { bold: i === 0, gray: i ? SLATE : 0.1, align: "right" }));
  page.fillRect(MARGIN, MARGIN + 66, INNER, 0.75, 0.8);
  return MARGIN + 82;
}

export function layoutBookingDetails(d: BookingDetailsData, qr: QrCode): PdfPage[] {
  const page = new PdfPage();
  let y = heading(page, "LAF Activity Center", "Booking Details", [d.ref, d.seqNo]);

  // The visit, large enough to read at a gate.
  page.fillRectRgb(MARGIN, y, INNER, 64, SKY);
  label(page, MARGIN + 14, y + 11, "Visit");
  page.text(MARGIN + 14, y + 23, fitSize(longDate(d.date), INNER - 190, 17, true, 11), longDate(d.date), { bold: true, rgb: NAVY });
  page.text(MARGIN + 14, y + 45, 11, `${formatTime12(d.start)} to ${formatTime12(d.end)}`, { rgb: NAVY });
  label(page, MARGIN + INNER - 150, y + 11, "Status");
  page.text(MARGIN + INNER - 150, y + 23, 14, d.statusLabel.toUpperCase(), { bold: true, rgb: BLUE });
  y += 80;

  const half = INNER / 2 - 10;
  const right = MARGIN + INNER / 2 + 10;
  label(page, MARGIN, y, "Place");
  label(page, right, y, "Group");
  let yl = paragraph(page, MARGIN, y + 12, half, 10.5, d.placeName, { bold: true, max: 2 });
  yl = paragraph(page, MARGIN, yl, half, 9, d.whereToGo, { gray: SLATE, max: 2 });
  let yr = paragraph(page, right, y + 12, half, 10.5, d.requestorName, { bold: true, max: 2 });
  yr = paragraph(page, right, yr, half, 9, `${d.requestorKind} · ${d.volunteersCount} volunteer${d.volunteersCount === 1 ? "" : "s"}${d.hasMinors ? " (some under 18)" : ""}`, { gray: SLATE });
  yr = paragraph(page, right, yr, half, 9, `Contact person: ${d.contactPerson}`, { gray: SLATE, max: 1 });
  y = Math.max(yl, yr) + 12;

  // Who is coming: two columns of numbered names; a line where a name was not given yet.
  label(page, MARGIN, y, `Volunteers (${d.names.length} of ${d.volunteersCount} named)`);
  y += 14;
  const perColumn = Math.ceil(d.volunteersCount / 2);
  for (let i = 0; i < d.volunteersCount; i += 1) {
    const x = i < perColumn ? MARGIN : right;
    const rowY = y + (i < perColumn ? i : i - perColumn) * 16;
    page.text(x, rowY, 9.5, `${i + 1}.`, { gray: SLATE });
    if (d.names[i]) page.text(x + 18, rowY, fitSize(d.names[i], half - 22, 9.5, false, 7), d.names[i]);
    else page.line(x + 18, rowY + 10, x + half, rowY + 10, 0.7);
  }
  y += perColumn * 16 + 4;
  page.text(MARGIN, y, 8.5, "Each volunteer signs the logbook at the gate and shows a valid ID.", { gray: SLATE });
  y += 22;

  label(page, MARGIN, y, "Program flow");
  y += 13;
  for (const item of d.items) {
    page.fillRect(MARGIN, y - 3, INNER, 0.5, 0.85);
    page.text(MARGIN, y + 3, 9.5, `${formatTime12(item.start)} to ${formatTime12(item.end)}`, { bold: true, rgb: NAVY });
    page.text(MARGIN, y + 16, 8, durationLabel(item.start, item.end), { gray: SLATE });
    const x = MARGIN + 132;
    let yi = paragraph(page, x, y + 3, INNER - 132, 10, item.activity, { bold: true, max: 1 });
    yi = paragraph(page, x, yi, INNER - 132, 8.5, item.participants, { gray: SLATE, max: 1 });
    if (item.materials) yi = paragraph(page, x, yi, INNER - 132, 8.5, `Materials: ${item.materials}`, { gray: SLATE, max: 2 });
    y = Math.max(yi, y + 28) + 6;
  }
  y += 8;

  const notes = [d.placeInstructions, d.bookingInstructions].filter((t) => t.trim()).join("\n");
  if (notes) {
    label(page, MARGIN, y, "Instructions");
    y = paragraph(page, MARGIN, y + 12, INNER, 9, notes, { max: 8 }) + 10;
  }

  // The foot: the code to the live status, and who at the foundation to call.
  const foot = A4.height - MARGIN - 96;
  page.fillRect(MARGIN, foot - 12, INNER, 0.75, 0.8);
  const size = 78;
  for (const r of qrRects(qr.pixels, qr.columns, qr.rows, size)) page.fillRect(MARGIN + r.x, foot + r.y, r.w, r.h, 0);
  const x = MARGIN + size + 16;
  label(page, x, foot, "Check this booking");
  let yf = paragraph(page, x, foot + 12, 200, 8.5, "Scan the code to see this booking's status as it is now. A cancelled or moved booking shows there.", { gray: SLATE });
  // The address on one line and the Request ID on the next, clear of the contact column.
  page.text(x, yf + 2, 7.5, d.trackUrl.replace(/^https?:\/\//, "").replace(/\?.*$/, ""), { gray: SLATE });
  page.text(x, yf + 12, 7.5, `Request ID ${d.ref}`, { gray: SLATE });
  label(page, right + 40, foot, "Little Ark Foundation contact");
  yf = paragraph(page, right + 40, foot + 12, half - 40, 10.5, d.coordinatorName || "The Resident Social Worker", { bold: true, max: 1 });
  if (d.coordinatorPhone) page.text(right + 40, yf, 10, d.coordinatorPhone);
  page.text(MARGIN, A4.height - MARGIN - 6, 7.5, `Printed ${d.printedAt} · Our Children. Our Future. · littlearkfoundation.org`, { gray: 0.5 });
  return [page];
}

export const buildBookingDetails = (d: BookingDetailsData, qr: QrCode): Buffer => buildPdf(layoutBookingDetails(d, qr), `LAF Activity Center Booking Details ${d.ref}`);

export interface ActivityPlanData {
  placeName: string;
  whereToGo: string;
  /** `yyyy-MM`. */
  month: string;
  statusLabel: string;
  /** Every activity of the month, each on its day. `start` and `end` are `HH:mm` (empty when not set). */
  items: { date: string; activity: string; goal: string; participants: string; start: string; end: string; materials: string }[];
  /** Days with something to say when they hold no activity: a holiday, a closed date. Keyed `yyyy-MM-dd`. */
  dayNotes: Record<string, string>;
  notes: string;
  preparedBy: string;
  preparedTitle: string;
  approvedBy: string;
  /** `yyyy-MM-dd`, once NCH approved it. */
  approvedOn: string | null;
}

const COLUMNS: { title: string; width: number }[] = [
  { title: "Date", width: 58 },
  { title: "Activity", width: 100 },
  { title: "Goal", width: 104 },
  { title: "Participants", width: 74 },
  { title: "Duration", width: 88 },
  { title: "Materials", width: INNER - 424 },
];
/** "10:00 to 11:00 AM"; "11:00 AM to 12:00 PM" when the two halves of the day differ. */
const timeSpan = (start: string, end: string): string => {
  const [a, b] = [formatTime12(start), formatTime12(end)];
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} to ${b}` : `${a} to ${b}`;
};
/** Bold letters are wider: wrap them to a narrower width, with room to spare. */
const wrapBold = (text: string, width: number, size: number): string[] => wrap(text, width * 0.88, size);
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The month as a complete list (owner, 26 Nov 2026): every day from the 1st to the last, and under each day its
 * activities with their goal, participants, duration and materials. A day with no activity is still listed, with
 * its reason when there is one (a holiday, a closed date). A day is never split across two pages.
 */
export function layoutActivityPlan(d: ActivityPlanData): PdfPage[] {
  const pages: PdfPage[] = [];
  let page = new PdfPage();
  let y = 0;
  const tableHead = () => {
    page.fillRectRgb(MARGIN, y, INNER, 18, NAVY);
    let x = MARGIN;
    for (const c of COLUMNS) {
      page.text(x + 5, y + 5, 8, c.title, { bold: true, rgb: [1, 1, 1] });
      x += c.width;
    }
    y += 18;
  };
  const start = (withTable: boolean) => {
    page = new PdfPage();
    pages.push(page);
    y = heading(page, "LAF Activity Center", "Monthly Activity Plan", [monthName(d.month), d.statusLabel]);
    if (withTable) tableHead();
  };

  start(false);
  label(page, MARGIN, y, "Place");
  label(page, MARGIN + INNER / 2 + 10, y, "Covers");
  const yl = paragraph(page, MARGIN, y + 12, INNER / 2 - 10, 10.5, d.placeName, { bold: true, max: 2 });
  paragraph(page, MARGIN, yl, INNER / 2 - 10, 9, d.whereToGo, { gray: SLATE, max: 1 });
  page.text(MARGIN + INNER / 2 + 10, y + 12, 10.5, monthCover(d.month), { bold: true });
  y = yl + 22;
  y = paragraph(page, MARGIN, y, INNER, 9.5, "The activities for the children in treatment and their carers, day by day, for the approval of National Children's Hospital.") + 10;
  tableHead();

  const [year, monthNo] = d.month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
  const widthOf = (c: number) => COLUMNS[c].width - 10;
  for (let day = 1; day <= days; day += 1) {
    const date = `${d.month}-${String(day).padStart(2, "0")}`;
    const weekday = WEEKDAY[new Date(Date.UTC(year, monthNo - 1, day)).getUTCDay()];
    const rows = d.items
      .filter((i) => i.date === date)
      .sort((a, b) => a.start.localeCompare(b.start) || a.activity.localeCompare(b.activity))
      .map((i) => {
        const cells = [wrapBold(i.activity, widthOf(1), 8.5), wrap(i.goal || "-", widthOf(2), 8.5), wrap(i.participants || "-", widthOf(3), 8.5), [durationLabel(i.start, i.end) || "-"], wrap(i.materials || "-", widthOf(5), 8.5)];
        // The time of day sits under the duration, in small letters.
        const time = i.start && i.end ? wrap(timeSpan(i.start, i.end), widthOf(4), 7) : [];
        return { cells, time, height: Math.max(...cells.map((c) => c.length), 1 + time.length) * 11 + 9 };
      });
    const height = rows.length ? Math.max(rows.reduce((sum, r) => sum + r.height, 0), 31) : 20;
    if (y + height > A4.height - MARGIN - 20) start(true);
    if (day % 2 === 0) page.fillRectRgb(MARGIN, y, INNER, height, SKY);

    page.text(MARGIN + 5, y + 5, 8.5, `${MONTH[monthNo - 1]} ${day}`, { bold: true, rgb: NAVY });
    if (rows.length) page.text(MARGIN + 5, y + 16, 7.5, weekday, { gray: SLATE });
    else {
      page.text(MARGIN + 5 + textWidth(`${MONTH[monthNo - 1]} ${day}`, 8.5, true) + 5, y + 6, 7.5, weekday.slice(0, 3), { gray: SLATE });
      page.text(MARGIN + COLUMNS[0].width + 5, y + 5, 8.5, d.dayNotes[date] ? `No activity (${d.dayNotes[date]})` : "No activity", { gray: 0.55 });
    }
    let rowY = y;
    rows.forEach((r, n) => {
      if (n) page.fillRect(MARGIN + COLUMNS[0].width, rowY, INNER - COLUMNS[0].width, 0.4, 0.88);
      let x = MARGIN + COLUMNS[0].width;
      r.cells.forEach((cell, c) => {
        cell.forEach((line, k) => page.text(x + 5, rowY + 5 + k * 11, 8.5, line, { bold: c === 0 || c === 3 }));
        if (c === 3) r.time.forEach((line, k) => page.text(x + 5, rowY + 16 + k * 10, 7, line, { gray: SLATE }));
        x += COLUMNS[c + 1].width;
      });
      rowY += r.height;
    });
    y += height;
    page.fillRect(MARGIN, y, INNER, 0.5, 0.82);
  }
  y += 14;

  // The closing part stays together: on a new page when it does not fit under the table.
  const closing = (d.notes.trim() ? wrap(d.notes, INNER, 9).length * 12 + 24 : 0) + 124;
  if (y + closing > A4.height - MARGIN) start(false);
  if (d.notes.trim()) {
    label(page, MARGIN, y, "Notes");
    y = paragraph(page, MARGIN, y + 12, INNER, 9, d.notes, { max: 6 }) + 10;
  }

  y += 34;
  const half = INNER / 2 - 24;
  const right = MARGIN + INNER / 2 + 24;
  for (const [x, over, name, under] of [
    [MARGIN, "Prepared by", d.preparedBy, d.preparedTitle],
    [right, "Approved by", d.approvedBy, "National Children's Hospital"],
  ] as const) {
    label(page, x, y - 30, over);
    page.line(x, y + 12, x + half, y + 12, 0.3, 0.75);
    // Room to sign above the line; the name and the office under it.
    page.text(x, y + 17, name ? fitSize(name, half, 10.5, true, 8) : 8.5, name || "Signature over printed name", name ? { bold: true } : { gray: SLATE });
    page.text(x, y + 31, 8.5, under, { gray: SLATE });
  }
  page.text(right, y + 46, 8.5, d.approvedOn ? `Date: ${longDate(d.approvedOn)}` : "Date:", { gray: SLATE });
  if (!d.approvedOn) page.line(right + textWidth("Date: ", 8.5), y + 55, right + half, y + 55, 0.5);

  pages.forEach((p, i) => p.text(MARGIN, A4.height - MARGIN - 6, 7.5, `${monthName(d.month)} · ${d.placeName} · Page ${i + 1} of ${pages.length}`, { gray: 0.5 }));
  return pages;
}

export const buildActivityPlan = (d: ActivityPlanData): Buffer => buildPdf(layoutActivityPlan(d), `LAF Activity Plan ${d.month}`);
