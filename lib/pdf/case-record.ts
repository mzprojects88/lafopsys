import { A4, PdfPage, buildPdf, wrap } from "./writer.ts";
import { drawLetterhead, longDate } from "./cash-ar.ts";
import { FORMS, NOTE_LABEL, noteKey, type FormData, type FormId } from "../case-files/forms.ts";

/**
 * One case record (0124) as LAF's paper form: the letterhead, the child's identifying lines, every
 * field of the form in order (checklists with every option, ticked or not, as on paper), then the
 * signature lines -- prepared and approved by the social worker, noted by the CEO, and the
 * parent/carer's conforme where the paper has one. Pages break wherever the content runs over.
 */
export interface CaseRecordPdfData {
  form: FormId;
  caseNumber: string;
  childName: string;
  ageSex: string;
  birthDate?: string;
  address?: string;
  diagnosis?: string;
  carerName?: string;
  heldOn: string;
  venue?: string;
  data: FormData;
  preparedBy: string;
  approvedBy: string;
  approvedOn: string;
  ceoName?: string;
  ceoTitle?: string;
  header?: string;
  accreditation?: string;
}

const MARGIN = 48;
const INNER = A4.width - MARGIN * 2;
const BOTTOM = A4.height - MARGIN;
const box = (on: boolean) => (on ? "[x]" : "[ ]");

export function layoutCaseRecord(d: CaseRecordPdfData): PdfPage[] {
  const def = FORMS[d.form];
  const pages: PdfPage[] = [];
  let page = new PdfPage();
  pages.push(page);
  let y = MARGIN;

  const footer = (p: PdfPage, n: number) =>
    p.text(MARGIN, BOTTOM + 14, 7.5, `Confidential: for case management only. ${def.title} · ${d.caseNumber} · page ${n}`, { gray: 0.45 });
  const ensure = (h: number) => {
    if (y + h <= BOTTOM) return;
    page = new PdfPage();
    pages.push(page);
    y = MARGIN;
  };
  const para = (value: string, size = 9.5, opts: { bold?: boolean; gray?: number; indent?: number } = {}) => {
    // Typed line breaks are paragraphs; a blank line is a gap.
    for (const part of value.split(/\r?\n/)) {
      if (!part.trim()) {
        y += size / 2;
        continue;
      }
      for (const line of wrap(part, INNER - (opts.indent ?? 0), size)) {
        ensure(size + 4);
        page.text(MARGIN + (opts.indent ?? 0), y, size, line, { bold: opts.bold, gray: opts.gray });
        y += size + 4;
      }
    }
  };
  const pair = (label: string, value: string | undefined) => {
    if (!value) return;
    para(`${label}: ${value}`);
  };

  drawLetterhead(page, y, d.header, d.accreditation);
  page.text(MARGIN + INNER, y, 13, def.title.toUpperCase(), { bold: true, align: "right" });
  page.text(MARGIN + INNER, y + 18, 9.5, `Case No. ${d.caseNumber}`, { align: "right" });
  page.text(MARGIN + INNER, y + 32, 9, longDate(d.heldOn), { gray: 0.35, align: "right" });
  y += 96;
  page.fillRect(MARGIN, y, INNER, 0.75, 0.8);
  y += 12;

  // A letter (0126): the recipient, the client in one line, the salutation and the body; signed by the social worker.
  if (def.letter) {
    const s = (k: string) => (typeof d.data[k] === "string" ? (d.data[k] as string) : "");
    for (const k of ["focal_person", "position", "agency", "address"]) if (s(k)) para(s(k), 10, { bold: k === "focal_person" });
    y += 10;
    para(`Client: ${[d.childName, d.ageSex, d.diagnosis].filter(Boolean).join(" · ")}`, 9.5, { gray: 0.25 });
    y += 8;
    if (s("salutation")) para(s("salutation"), 10);
    y += 4;
    para(s("body"), 10);
    ensure(90);
    y += 46;
    page.text(MARGIN, y, 10, d.preparedBy, { bold: true });
    page.fillRect(MARGIN, y + 14, INNER / 2 - 16, 0.75, 0.3);
    page.text(MARGIN, y + 20, 9, "Resident Social Worker, Little Ark Foundation Inc.", { gray: 0.3 });
    pages.forEach((p, i) => footer(p, i + 1));
    return pages;
  }

  pair("Name of Beneficiary", d.childName);
  pair("Age / Sex", d.ageSex);
  pair("Date of Birth", d.birthDate ? longDate(d.birthDate) : undefined);
  pair("Address", d.address);
  pair("Diagnosis", d.diagnosis);
  pair("Name of Parent/Caregiver", d.carerName);
  if (def.session) pair("Venue", d.venue);
  y += 6;

  for (const f of def.fields) {
    const v = d.data[f.key];
    if (f.type === "section") {
      ensure(30);
      y += 6;
      page.text(MARGIN, y, 10, f.label.toUpperCase(), { bold: true });
      y += 16;
      continue;
    }
    if (f.type === "checks" || f.type === "choice") {
      const picked = f.type === "checks" ? (Array.isArray(v) ? (v as string[]) : []) : typeof v === "string" ? [v] : [];
      para(f.label, 9.5, { bold: true });
      for (const o of f.options) para(`${box(picked.includes(o))} ${o}`, 9, { indent: 10 });
      const note = f.type === "checks" ? d.data[noteKey(f.key)] : undefined;
      if (typeof note === "string" && note) para(`${NOTE_LABEL}: ${note}`, 9, { indent: 10 });
      y += 4;
      continue;
    }
    if (f.type === "ratings") {
      const r = (v as Record<string, string>) ?? {};
      para(f.label, 9.5, { bold: true });
      for (const row of f.rows) para(`${row}: ${r[row] ?? "-"}`, 9, { indent: 10 });
      y += 4;
      continue;
    }
    if (f.type === "table") {
      const rows = Array.isArray(v) ? (v as Record<string, string>[]) : [];
      para(f.label, 9.5, { bold: true });
      if (!rows.length) para("None recorded.", 9, { indent: 10, gray: 0.45 });
      for (const row of rows) para(f.columns.map((c) => `${c.label}: ${row[c.key] ?? "-"}`).join("  |  "), 8.5, { indent: 10 });
      y += 4;
      continue;
    }
    const text = typeof v === "string" ? (f.type === "date" ? longDate(v) : v) : "";
    if (f.type === "textarea") {
      para(f.label, 9.5, { bold: true });
      para(text || "-", 9.5, { indent: 10 });
      y += 4;
    } else {
      para(`${f.label}: ${text || "-"}`);
    }
  }

  // Signatures: each a line with the name above and the role below.
  const signers: { name: string; role: string }[] = [
    { name: d.preparedBy, role: "Prepared by: Resident Social Worker" },
    { name: d.approvedBy, role: `Reviewed and approved by: Social Worker · ${longDate(d.approvedOn)}` },
    { name: d.ceoName ?? "", role: `Noted by: ${d.ceoTitle ?? "Chief Executive Officer"}` },
    ...(def.conforme ? [{ name: "", role: "Conforme: Name and Signature of Parent/Caregiver" }] : []),
    ...(def.extraSigners ?? []).map((role) => ({ name: "", role })),
  ];
  ensure(40 + Math.ceil(signers.length / 2) * 64);
  y += 30;
  const width = INNER / 2 - 16;
  signers.forEach((s, i) => {
    const x = MARGIN + (i % 2) * (width + 32);
    const rowY = y + Math.floor(i / 2) * 64;
    page.text(x + width / 2, rowY, 9.5, s.name, { align: "center" });
    page.fillRect(x, rowY + 14, width, 0.75, 0.3);
    page.text(x + width / 2, rowY + 20, 8, s.role, { align: "center", gray: 0.3 });
    page.text(x + width / 2, rowY + 32, 8, "Date: ____________________", { align: "center", gray: 0.45 });
  });

  pages.forEach((p, i) => footer(p, i + 1));
  return pages;
}

export function buildCaseRecordPdf(d: CaseRecordPdfData): Buffer {
  return buildPdf(layoutCaseRecord(d), `${FORMS[d.form].title}, ${d.caseNumber}`);
}
