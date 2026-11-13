import { A4, PdfPage, buildPdf, fitSize, textWidth, wrap } from "./writer.ts";
import { drawLetterhead } from "./cash-ar.ts";

/**
 * The branded report document (Nov 2026): one layout for every report the
 * Operating System generates (Programs, Analytics, the Report generator, Donors,
 * the DTR report). A page sends the figures it shows as a ReportSpec; this file
 * only lays them out, so what is printed is exactly what was on screen.
 *
 * Page 1 carries the letterhead; later pages a running header; every page the
 * footer (registration line, generated when and by whom, page i of n).
 */

export interface ReportKpi {
  label: string;
  value: string;
  /** The same figure for the previous range, printed small under the value. */
  previous?: string;
  /** "+12%" / "-3" … printed beside the previous figure. */
  change?: string;
}

export interface ReportTable {
  columns: string[];
  rows: (string | number)[][];
  /** A last row drawn bold, for totals. */
  totals?: (string | number)[];
}

export interface ReportChart {
  /** Bars over the labels, series stacked on each other, or a sideways ranking. */
  kind: "bar" | "stacked" | "rank";
  labels: string[];
  series: { label: string; values: number[] }[];
}

export interface ReportSection {
  heading: string;
  /** What the figures count and where they come from. */
  description?: string;
  kpis?: ReportKpi[];
  table?: ReportTable;
  chart?: ReportChart;
  /** The AI's comparison for this section, printed only when the person kept it. */
  analysis?: string;
}

export interface ReportSpec {
  title: string;
  subtitle?: string;
  /** "Oct 2026" / "Nov 2 – Nov 8, 2026". */
  period: string;
  /** The range the figures are compared with. */
  previousPeriod?: string;
  /** Active filters, printed on the cover so the reader knows what the figures cover. */
  filters?: string[];
  /** The overall AI comparison, printed under the cover when kept. */
  analysis?: string;
  sections: ReportSection[];
}

export interface ReportBranding {
  /** The registration line from Settings (SEC · TIN · DSWD licence). */
  header?: string;
  /** "DSWD Accreditation No. …" from Settings. */
  accreditation?: string;
  orgAddress?: string;
  /** "5 Nov 2026, 3:12 PM". */
  generatedAt: string;
  /** "Jane Doe, Office Admin". */
  generatedBy: string;
}

const MARGIN = 44;
const INNER = A4.width - MARGIN * 2;
const BOTTOM = A4.height - MARGIN - 26;
const AI_LABEL = "AI-generated analysis - review before sharing";
const PALETTE: [number, number, number][] = [
  [0.15, 0.39, 0.92],
  [0.03, 0.46, 0.28],
  [0.71, 0.28, 0.03],
  [0.47, 0.21, 0.74],
  [0.0, 0.55, 0.65],
];
const TINT: [number, number, number] = [0.94, 0.96, 1];
const ROW = 14;

/** Pages that grow as content flows; every page starts below its header. */
class Flow {
  readonly pages: PdfPage[] = [];
  y = 0;
  private readonly spec: ReportSpec;
  constructor(spec: ReportSpec) {
    this.spec = spec;
    this.newPage();
  }
  get page(): PdfPage {
    return this.pages[this.pages.length - 1]!;
  }
  newPage(): void {
    const page = new PdfPage();
    this.pages.push(page);
    if (this.pages.length > 1) {
      page.text(MARGIN, MARGIN - 12, 8, `${this.spec.title} - ${this.spec.period}`, { gray: 0.45 });
      page.line(MARGIN, MARGIN, A4.width - MARGIN, MARGIN, 0.85);
      this.y = MARGIN + 12;
    } else this.y = MARGIN;
  }
  /** Starts a new page unless `height` more points fit on this one. */
  ensure(height: number): void {
    if (this.y + height > BOTTOM) this.newPage();
  }
}

function fmt(v: string | number): string {
  return typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 })) : v;
}

function paragraph(flow: Flow, text: string, size: number, gray: number, width = INNER, x = MARGIN): void {
  for (const line of wrap(text, width, size)) {
    flow.ensure(size + 4);
    flow.page.text(x, flow.y, size, line, { gray });
    flow.y += size + 4;
  }
}

/** A tinted box with the AI label and the wrapped text; starts a new page if less than three lines fit. */
function analysisBox(flow: Flow, text: string): void {
  const size = 9;
  const lines = wrap(text, INNER - 20, size);
  const height = 20 + lines.length * (size + 3) + 8;
  if (flow.y + Math.min(height, 20 + 3 * (size + 3)) > BOTTOM) flow.newPage();
  // The box may itself span pages: draw it in page-sized pieces.
  let i = 0;
  while (i < lines.length) {
    const room = Math.floor((BOTTOM - flow.y - 28) / (size + 3));
    const chunk = lines.slice(i, i + Math.max(room, 1));
    const h = 20 + chunk.length * (size + 3) + 6;
    flow.page.fillRectRgb(MARGIN, flow.y, INNER, h, TINT);
    if (i === 0) flow.page.text(MARGIN + 10, flow.y + 6, 7, AI_LABEL, { bold: true, gray: 0.35 });
    let y = flow.y + 20;
    for (const line of chunk) {
      flow.page.text(MARGIN + 10, y, size, line, { gray: 0.15 });
      y += size + 3;
    }
    flow.y += h + 8;
    i += chunk.length;
    if (i < lines.length) flow.newPage();
  }
}

function kpis(flow: Flow, items: ReportKpi[]): void {
  const perRow = Math.min(4, Math.max(1, items.length));
  const gap = 8;
  const w = (INNER - gap * (perRow - 1)) / perRow;
  for (let i = 0; i < items.length; i += perRow) {
    const row = items.slice(i, i + perRow);
    const h = row.some((k) => k.previous || k.change) ? 50 : 40;
    flow.ensure(h + 8);
    row.forEach((k, j) => {
      const x = MARGIN + j * (w + gap);
      flow.page.fillRect(x, flow.y, w, h, 0.96);
      flow.page.text(x + 8, flow.y + 7, fitSize(k.label, w - 16, 7.5, false, 5.5), k.label, { gray: 0.45 });
      flow.page.text(x + 8, flow.y + 19, fitSize(k.value, w - 16, 14, true), k.value, { bold: true });
      if (k.previous || k.change) {
        const prev = k.previous ? `prev. ${k.previous}` : "";
        flow.page.text(x + 8, flow.y + 37, 7.5, [prev, k.change].filter(Boolean).join("  "), { gray: 0.4 });
      }
    });
    flow.y += h + 8;
  }
}

function table(flow: Flow, t: ReportTable): void {
  const cols = t.columns.length;
  if (!cols) return;
  const firstW = cols === 1 ? INNER : Math.min(INNER * 0.4, Math.max(INNER * 0.22, INNER - (cols - 1) * 60));
  const otherW = cols === 1 ? 0 : (INNER - firstW) / (cols - 1);
  const xs = t.columns.map((_, i) => (i === 0 ? MARGIN : MARGIN + firstW + (i - 1) * otherW));
  const size = otherW > 0 && otherW < 46 ? 7 : 8;
  const cell = (page: PdfPage, y: number, i: number, value: string | number, bold = false, gray = 0) => {
    const text = fmt(value);
    const width = (i === 0 ? firstW : otherW) - 8;
    const s = fitSize(text, width, size, bold, 5.5);
    if (i === 0) page.text(xs[0]! + 4, y + 3, s, text, { bold, gray });
    else page.text(xs[i]! + (i === 0 ? 0 : otherW) - 4, y + 3, s, text, { bold, gray, align: "right" });
  };
  // Narrow columns get a two-line header instead of a squashed one.
  const headSize = size - 1;
  const headLines = t.columns.map((c, i) => (i === 0 ? [c] : wrap(c, (i === 0 ? firstW : otherW) - 6, headSize).slice(0, 2)));
  const headH = ROW * Math.max(1, ...headLines.map((l) => l.length));
  const header = () => {
    flow.ensure(headH + ROW * 2);
    flow.page.fillRect(MARGIN, flow.y, INNER, headH, 0.92);
    headLines.forEach((lines, i) => {
      const yTop = flow.y + (headH - lines.length * ROW);
      lines.forEach((line, n) => {
        const width = (i === 0 ? firstW : otherW) - 6;
        const s = fitSize(line, width, headSize, true, 5);
        if (i === 0) flow.page.text(xs[0]! + 4, yTop + n * ROW + 3, s, line, { bold: true, gray: 0.25 });
        else flow.page.text(xs[i]! + otherW - 3, yTop + n * ROW + 3, s, line, { bold: true, gray: 0.25, align: "right" });
      });
    });
    flow.y += headH;
  };
  header();
  t.rows.forEach((r, n) => {
    if (flow.y + ROW > BOTTOM) {
      flow.newPage();
      header();
    }
    if (n % 2 === 1) flow.page.fillRect(MARGIN, flow.y, INNER, ROW, 0.975);
    r.forEach((v, i) => i < cols && cell(flow.page, flow.y, i, v));
    flow.y += ROW;
  });
  if (t.totals) {
    if (flow.y + ROW > BOTTOM) {
      flow.newPage();
      header();
    }
    flow.page.line(MARGIN, flow.y, A4.width - MARGIN, flow.y, 0.6);
    t.totals.forEach((v, i) => i < cols && cell(flow.page, flow.y, i, v, true));
    flow.y += ROW;
  }
  flow.y += 6;
}

function chart(flow: Flow, c: ReportChart): void {
  const n = c.labels.length;
  if (!n || !c.series.length) return;
  if (c.kind === "rank") {
    const rowH = 13;
    const labelW = INNER * 0.38;
    const max = Math.max(1, ...c.series[0]!.values);
    flow.ensure(Math.min(n, 6) * rowH + 10);
    c.labels.forEach((label, i) => {
      if (flow.y + rowH > BOTTOM) flow.newPage();
      const v = c.series[0]!.values[i] ?? 0;
      flow.page.text(MARGIN, flow.y + 2, 8, label, { gray: 0.2 });
      const barW = Math.max(1, ((INNER - labelW - 50) * v) / max);
      flow.page.fillRectRgb(MARGIN + labelW, flow.y + 2, barW, rowH - 5, PALETTE[0]!);
      flow.page.text(MARGIN + labelW + barW + 4, flow.y + 2, 8, fmt(v), { gray: 0.3 });
      flow.y += rowH;
    });
    flow.y += 8;
    return;
  }
  const height = 120;
  // The legend's items, wrapped onto lines that fit the width.
  const legendRows: { label: string; k: number; x: number }[][] = [];
  if (c.series.length > 1) {
    let lx = MARGIN;
    let row: { label: string; k: number; x: number }[] = [];
    c.series.forEach((s, k) => {
      const w = textWidth(s.label, 7.5) + 22;
      if (row.length && lx + w > A4.width - MARGIN) {
        legendRows.push(row);
        row = [];
        lx = MARGIN;
      }
      row.push({ label: s.label, k, x: lx });
      lx += w;
    });
    legendRows.push(row);
  }
  const legendH = legendRows.length * 12;
  flow.ensure(height + 30 + legendH);
  const top = flow.y + legendH;
  const base = top + height;
  const totals = c.labels.map((_, i) => (c.kind === "stacked" ? c.series.reduce((s, x) => s + (x.values[i] ?? 0), 0) : Math.max(...c.series.map((x) => x.values[i] ?? 0))));
  const max = Math.max(1, ...totals);
  legendRows.forEach((row, r) =>
    row.forEach(({ label, k, x }) => {
      flow.page.fillRectRgb(x, flow.y + r * 12 + 2, 7, 7, PALETTE[k % PALETTE.length]!);
      flow.page.text(x + 10, flow.y + r * 12 + 1, 7.5, label, { gray: 0.35 });
    }),
  );
  flow.page.line(MARGIN, base, A4.width - MARGIN, base, 0.7);
  const slot = INNER / n;
  const groupW = Math.min(slot * 0.7, 40);
  const showValues = n <= 16;
  c.labels.forEach((label, i) => {
    const x0 = MARGIN + i * slot + (slot - groupW) / 2;
    if (c.kind === "stacked") {
      let y = base;
      c.series.forEach((s, k) => {
        const h = ((s.values[i] ?? 0) / max) * height;
        if (h > 0) flow.page.fillRectRgb(x0, y - h, groupW, h, PALETTE[k % PALETTE.length]!);
        y -= h;
      });
      if (showValues && totals[i]) flow.page.text(x0 + groupW / 2, y - 9, 7, fmt(totals[i]!), { gray: 0.3, align: "center" });
    } else {
      const bw = groupW / c.series.length;
      c.series.forEach((s, k) => {
        const v = s.values[i] ?? 0;
        const h = (v / max) * height;
        if (h > 0) flow.page.fillRectRgb(x0 + k * bw, base - h, bw - 1, h, PALETTE[k % PALETTE.length]!);
        if (showValues && v && c.series.length === 1) flow.page.text(x0 + groupW / 2, base - h - 9, 7, fmt(v), { gray: 0.3, align: "center" });
      });
    }
    const every = Math.max(1, Math.ceil(n / 16));
    if (i % every === 0) flow.page.text(MARGIN + i * slot + slot / 2, base + 3, fitSize(label, slot - 2, 7, false, 5), label, { gray: 0.4, align: "center" });
  });
  flow.y = base + 14 + 8;
}

/** All pages, laid out; separate from the file build so it can be tested. */
export function layoutReportDoc(spec: ReportSpec, branding: ReportBranding): PdfPage[] {
  const flow = new Flow(spec);
  drawLetterhead(flow.page, flow.y, branding.header, branding.accreditation);
  if (branding.orgAddress) flow.page.text(MARGIN, flow.y + 72, 7.5, branding.orgAddress, { gray: 0.45 });
  flow.y += 92;
  flow.page.text(MARGIN, flow.y, 18, spec.title, { bold: true });
  flow.y += 24;
  if (spec.subtitle) {
    flow.page.text(MARGIN, flow.y, 10, spec.subtitle, { gray: 0.35 });
    flow.y += 14;
  }
  flow.page.text(MARGIN, flow.y, 10, `Period: ${spec.period}${spec.previousPeriod ? `   -   compared with ${spec.previousPeriod}` : ""}`, { gray: 0.2 });
  flow.y += 14;
  if (spec.filters?.length) {
    paragraph(flow, `Filters: ${spec.filters.join("; ")}`, 8, 0.45);
    flow.y += 2;
  }
  flow.page.text(MARGIN, flow.y, 8, `Prepared by ${branding.generatedBy}, ${branding.generatedAt}`, { gray: 0.45 });
  flow.y += 16;
  if (spec.analysis) analysisBox(flow, spec.analysis);

  for (const s of spec.sections) {
    const descH = s.description ? wrap(s.description, INNER, 8.5).length * 12.5 + 4 : 0;
    const firstH = s.kpis?.length ? 58 : s.chart ? 162 : s.table ? ROW * 3 + 6 : 0;
    flow.ensure(28 + descH + firstH);
    flow.y += 6;
    flow.page.text(MARGIN, flow.y, 12, s.heading, { bold: true });
    flow.y += 16;
    flow.page.line(MARGIN, flow.y, A4.width - MARGIN, flow.y, 0.8);
    flow.y += 6;
    if (s.description) {
      paragraph(flow, s.description, 8.5, 0.4);
      flow.y += 4;
    }
    if (s.kpis?.length) kpis(flow, s.kpis);
    if (s.chart) chart(flow, s.chart);
    if (s.table) table(flow, s.table);
    if (s.analysis) analysisBox(flow, s.analysis);
  }

  const total = flow.pages.length;
  flow.pages.forEach((pg, i) => {
    const y = A4.height - MARGIN - 2;
    pg.line(MARGIN, y - 4, A4.width - MARGIN, y - 4, 0.85);
    if (branding.header) pg.text(MARGIN, y, fitSize(branding.header, INNER * 0.75, 6.5, false, 5), branding.header, { gray: 0.5 });
    pg.text(A4.width - MARGIN, y, 7, `Page ${i + 1} of ${total}`, { gray: 0.5, align: "right" });
    pg.text(MARGIN, y + 10, 6.5, `Generated ${branding.generatedAt} by ${branding.generatedBy}`, { gray: 0.5 });
  });
  return flow.pages;
}

export function buildReportPdf(spec: ReportSpec, branding: ReportBranding): Buffer {
  return buildPdf(layoutReportDoc(spec, branding), `${spec.title} - ${spec.period}`);
}
