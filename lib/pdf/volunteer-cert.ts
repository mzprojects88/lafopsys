import { A4, PdfPage, buildPdf, fitSize, wrap } from "./writer.ts";
import { drawLetterhead, longDate } from "./cash-ar.ts";

/**
 * Certificate of Volunteer Service (0116): the volunteer's name, the hours served over a period
 * and by activity, signed by the foundation's certificate signatory (Settings). One page.
 */
export interface VolunteerCertData {
  volunteerName: string;
  /** yyyy-mm-dd */
  from: string;
  to: string;
  totalHours: number;
  sessions: number;
  byActivity: { activity: string; hours: number }[];
  issuedOn: string;
  header?: string;
  signatoryName?: string;
  signatoryPosition?: string;
}

const MARGIN = 48;
const INNER = A4.width - MARGIN * 2;
const hoursText = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} hour${h === 1 ? "" : "s"}`;

export function layoutVolunteerCert(d: VolunteerCertData): PdfPage[] {
  const page = new PdfPage();
  let y = MARGIN;
  drawLetterhead(page, y, d.header);
  page.text(MARGIN + INNER, y, 14, "CERTIFICATE OF VOLUNTEER SERVICE", { bold: true, align: "right" });
  page.text(MARGIN + INNER, y + 20, 10, longDate(d.issuedOn), { gray: 0.35, align: "right" });
  y += 110;
  page.fillRect(MARGIN, y, INNER, 0.75, 0.8);
  y += 40;

  page.text(A4.width / 2, y, 11, "This certifies that", { align: "center", gray: 0.3 });
  y += 30;
  const nameSize = fitSize(d.volunteerName, INNER, 24, true, 12);
  page.text(A4.width / 2, y, nameSize, d.volunteerName, { bold: true, align: "center" });
  y += nameSize + 22;
  const period = d.from === d.to ? `on ${longDate(d.from)}` : `from ${longDate(d.from)} to ${longDate(d.to)}`;
  for (const line of wrap(`has given ${hoursText(d.totalHours)} of volunteer service to Little Ark Foundation, Inc. over ${d.sessions} session${d.sessions === 1 ? "" : "s"} ${period}, helping children with cancer and their families.`, INNER - 40, 12)) {
    page.text(A4.width / 2, y, 12, line, { align: "center" });
    y += 18;
  }
  y += 18;

  if (d.byActivity.length) {
    page.text(A4.width / 2, y, 9.5, "Service by activity", { align: "center", gray: 0.35, bold: true });
    y += 18;
    for (const a of d.byActivity) {
      page.text(A4.width / 2 - 10, y, 10.5, a.activity, { align: "right" });
      page.text(A4.width / 2 + 10, y, 10.5, hoursText(a.hours), { gray: 0.25 });
      y += 16;
    }
  }

  y += 28;
  for (const line of wrap("With our gratitude for your time and care. Every hour given lets the house welcome one more family.", INNER - 80, 10)) {
    page.text(A4.width / 2, y, 10, line, { align: "center", gray: 0.35 });
    y += 14;
  }

  const signY = Math.max(y + 80, A4.height - MARGIN - 110);
  const width = INNER / 2;
  const left = MARGIN + (INNER - width) / 2;
  page.text(A4.width / 2, signY - 16, 10.5, d.signatoryName ?? "", { align: "center" });
  page.fillRect(left, signY, width, 0.75, 0.3);
  let captionY = signY + 8;
  if (d.signatoryPosition) {
    page.text(A4.width / 2, captionY, 9, d.signatoryPosition, { align: "center", gray: 0.15 });
    captionY += 12;
  }
  page.text(A4.width / 2, captionY, 9, "Little Ark Foundation, Inc.", { align: "center", gray: 0.35 });
  return [page];
}

export function buildVolunteerCert(d: VolunteerCertData): Buffer {
  return buildPdf(layoutVolunteerCert(d), `Certificate of volunteer service, ${d.volunteerName}`);
}
