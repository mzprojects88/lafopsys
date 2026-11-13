// Report graphs (Nov 2026): every graph a report draws, one drawing for the PDF, the report on screen and the graph
// builder's preview (chartSvg). Text is plain Latin (the PDF's Helvetica has no arrows, peso sign or division sign),
// so markers are shapes. Browser-safe: imports only the page module.
import { PdfPage, fitSize, regionSvg, textWidth, wrap, type Rgb } from "./page.ts";

export type ChartKind = "bar" | "hbar" | "rank" | "stacked" | "line" | "area" | "combo" | "pie" | "donut" | "gauge" | "scorecard" | "variance" | "kpi";

/** One figure in a scorecard, variance, gauge or big-number graph, with its text worked out by the report. */
export interface ChartRow {
  label: string;
  /** Scorecard: the period's figure; variance: the change in percent; gauge: the year to date; kpi: unused. */
  value: number;
  /** Scorecard: the year to date (the period included); its bar runs to the goal, else to this. */
  ytd?: number;
  /** The year's goal (scorecard and gauge). */
  goal?: number;
  /** The figure the period before (a scorecard without a year to date marks it). */
  previous?: number;
  /** The main text ("Nov 1,020  +9% vs Oct") and the line under it ("YTD 9,480 of 12,000 (79%)"). */
  text?: string;
  sub?: string;
  /** Good news (green), bad (red) or neither (grey): spending going up is bad. */
  good?: boolean | null;
}

export interface ReportChart {
  /** bar / stacked / combo / line / area over the labels; hbar (= rank) sideways; pie / donut as shares; gauge,
   * scorecard, variance and kpi from rows. */
  kind: ChartKind;
  labels: string[];
  series: { label: string; values: number[] }[];
  rows?: ChartRow[];
  /** Printed above the graph, and under it (e.g. "Sample figures"). */
  title?: string;
  note?: string;
  /** A label drawn stronger (the current period) and a dashed line at a value (the goal's pace). */
  highlight?: number;
  reference?: { value: number; label: string };
  /** The share of the year gone (0..1): the scorecard's and the gauge's pace marker. */
  pace?: number;
  /** Values printed on the bars (default: when they fit). */
  values?: boolean;
}

export const PALETTE: Rgb[] = [
  [0.15, 0.39, 0.92],
  [0.03, 0.46, 0.28],
  [0.71, 0.28, 0.03],
  [0.47, 0.21, 0.74],
  [0.0, 0.55, 0.65],
  [0.85, 0.6, 0.1],
  [0.8, 0.2, 0.45],
  [0.45, 0.45, 0.45],
];
const GOOD: Rgb = [0.05, 0.55, 0.25];
const BAD: Rgb = [0.8, 0.15, 0.15];
const MUTED: Rgb = [0.55, 0.55, 0.55];
const PACE: Rgb = [0.85, 0.45, 0.05];
const color = (k: number) => PALETTE[k % PALETTE.length]!;
const lighten = (c: Rgb, t: number): Rgb => [c[0] + (1 - c[0]) * t, c[1] + (1 - c[1]) * t, c[2] + (1 - c[2]) * t];
const tone = (good: boolean | null | undefined): Rgb => (good == null ? MUTED : good ? GOOD : BAD);

export function fmt(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
/** 1,234,567 -> "1.2M", for labels on small bars. */
function short(v: number): string {
  const a = Math.abs(v);
  return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e4 ? `${Math.round(v / 1e3)}K` : fmt(Math.round(v * 10) / 10);
}

const TITLE_H = 15;
const NOTE_H = 11;
const PLOT_H = 120;

/** The legend's items wrapped onto lines that fit the width. */
function legendRows(labels: string[], width: number): { label: string; k: number; x: number }[][] {
  const rows: { label: string; k: number; x: number }[][] = [];
  let lx = 0;
  let row: { label: string; k: number; x: number }[] = [];
  labels.forEach((label, k) => {
    const w = textWidth(label, 7.5) + 22;
    if (row.length && lx + w > width) {
      rows.push(row);
      row = [];
      lx = 0;
    }
    row.push({ label, k, x: lx });
    lx += w;
  });
  if (row.length) rows.push(row);
  return rows;
}
function drawLegend(page: PdfPage, x: number, y: number, width: number, labels: string[], swatch: (k: number) => Rgb = color): number {
  const rows = legendRows(labels, width);
  rows.forEach((row, r) =>
    row.forEach(({ label, k, x: lx }) => {
      page.fillRectRgb(x + lx, y + r * 12 + 2, 7, 7, swatch(k));
      page.text(x + lx + 10, y + r * 12 + 1, 7.5, label, { gray: 0.35 });
    }),
  );
  return rows.length * 12;
}

/** Points along an arc (angles in radians, 0 = right, counter-clockwise up the page). */
function arc(cx: number, cy: number, r: number, from: number, to: number): [number, number][] {
  const steps = Math.max(2, Math.ceil((Math.abs(to - from) / Math.PI) * 48));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as [number, number];
  });
}

const plotKinds = new Set<ChartKind>(["bar", "stacked", "line", "area", "combo"]);
const wantsLegend = (c: ReportChart) => c.series.length > 1 || c.kind === "combo";

/** How tall a graph is at this width, so a page can keep it whole. */
export function chartHeight(c: ReportChart, width: number): number {
  const head = (c.title ? TITLE_H : 0) + (c.note ? NOTE_H : 0);
  const rows = c.rows ?? [];
  switch (c.kind) {
    case "hbar":
    case "rank":
      return head + c.labels.length * Math.max(13, c.series.length * 9 + 4) + 8 + (c.series.length > 1 ? legendRows(c.series.map((s) => s.label), width).length * 12 : 0);
    case "pie":
    case "donut":
      return head + Math.max(124, c.labels.length * 13 + 8) + 8;
    case "gauge":
      return head + Math.ceil(rows.length / 4) * 92 + 4;
    case "scorecard":
      return head + rows.length * 30 + 16;
    case "variance":
      return head + rows.length * 15 + 12;
    case "kpi":
      return head + Math.ceil(rows.length / 4) * 50 + 4;
    default:
      return head + (wantsLegend(c) ? legendRows(c.series.map((s) => s.label), width).length * 12 : 0) + PLOT_H + 24;
  }
}

/** Draws the graph with its top-left at (x, y), `width` wide; gives the height used (as chartHeight). */
export function drawChart(page: PdfPage, x: number, y: number, width: number, c: ReportChart): number {
  const height = chartHeight(c, width);
  let top = y;
  if (c.title) {
    page.text(x, top, fitSize(c.title, width, 9, true, 6), c.title, { bold: true, gray: 0.2 });
    top += TITLE_H;
  }
  if (plotKinds.has(c.kind)) plot(page, x, top, width, c);
  else if (c.kind === "hbar" || c.kind === "rank") bars(page, x, top, width, c);
  else if (c.kind === "pie" || c.kind === "donut") pie(page, x, top, width, c);
  else if (c.kind === "gauge") gauges(page, x, top, width, c);
  else if (c.kind === "scorecard") scorecard(page, x, top, width, c);
  else if (c.kind === "variance") variance(page, x, top, width, c);
  else if (c.kind === "kpi") kpis(page, x, top, width, c);
  if (c.note) page.text(x, y + height - NOTE_H + 1, 7, c.note, { gray: 0.5 });
  return height;
}

/** Bars (grouped), stacked bars, lines, areas, or bars with the last series as a line, over the labels. */
function plot(page: PdfPage, x: number, y: number, width: number, c: ReportChart) {
  const n = c.labels.length;
  if (!n || !c.series.length) return;
  const legendH = wantsLegend(c) ? drawLegend(page, x, y, width, c.series.map((s) => s.label)) : 0;
  const base = y + legendH + PLOT_H;
  const v = (s: { values: number[] }, i: number) => Math.max(0, s.values[i] ?? 0);
  const totals = c.labels.map((_, i) => (c.kind === "stacked" ? c.series.reduce((s, x2) => s + v(x2, i), 0) : Math.max(...c.series.map((s) => v(s, i)))));
  const max = Math.max(1, ...totals, c.reference?.value ?? 0) * 1.08;
  const yOf = (val: number) => base - (val / max) * PLOT_H;
  page.line(x, base, x + width, base, 0.7);
  const slot = width / n;
  const every = Math.max(1, Math.ceil(n / 16));
  const showValues = c.values ?? n <= 16;
  const barSeries = c.kind === "combo" ? c.series.slice(0, -1) : c.kind === "bar" || c.kind === "stacked" ? c.series : [];
  const groupW = Math.min(slot * 0.7, barSeries.length > 1 && c.kind !== "stacked" ? 22 * barSeries.length : 40);
  c.labels.forEach((label, i) => {
    const x0 = x + i * slot + (slot - groupW) / 2;
    const strong = c.highlight === i;
    if (c.kind === "stacked") {
      let top = base;
      c.series.forEach((s, k) => {
        const h = (v(s, i) / max) * PLOT_H;
        if (h > 0) page.fillRectRgb(x0, top - h, groupW, h, strong || c.highlight == null ? color(k) : lighten(color(k), 0.35));
        top -= h;
      });
      if (showValues && totals[i]) page.text(x0 + groupW / 2, top - 9, 7, short(totals[i]!), { gray: 0.3, align: "center" });
    } else if (barSeries.length) {
      const bw = groupW / barSeries.length;
      barSeries.forEach((s, k) => {
        const val = v(s, i);
        const h = (val / max) * PLOT_H;
        const fill = c.highlight == null || strong ? color(k) : lighten(color(k), 0.35);
        if (h > 0) page.fillRectRgb(x0 + k * bw, base - h, Math.max(1, bw - 1), h, fill);
        if (showValues && val && (barSeries.length === 1 || bw >= 16)) page.text(x0 + k * bw + bw / 2, base - h - 9, barSeries.length === 1 ? 7 : 6, short(val), { gray: 0.3, align: "center" });
      });
    }
    if (i % every === 0) page.text(x + i * slot + slot / 2, base + 3, fitSize(label, slot - 2, 7, strong, 5), label, { gray: strong ? 0.1 : 0.4, bold: strong, align: "center" });
  });
  // Lines (line, area, and the combo's last series) over the same scale.
  const lineSeries = c.kind === "combo" ? c.series.slice(-1) : c.kind === "line" || c.kind === "area" ? c.series : [];
  lineSeries.forEach((s, j) => {
    const k = c.kind === "combo" ? c.series.length - 1 : j;
    const pts = c.labels.map((_, i) => [x + i * slot + slot / 2, yOf(v(s, i))] as [number, number]);
    if (c.kind === "area" && pts.length > 1) page.fillPath([[pts[0]![0], base], ...pts, [pts[pts.length - 1]![0], base]], lighten(color(k), 0.75));
    page.strokePath(pts, color(k), 1.4);
    pts.forEach(([px, py], i) => {
      const r = c.highlight === i ? 2.6 : 1.8;
      page.fillRectRgb(px - r, py - r, r * 2, r * 2, color(k));
      if (showValues && lineSeries.length === 1 && n <= 16 && v(s, i)) page.text(px, py - 11, 7, short(v(s, i)), { gray: 0.3, align: "center" });
    });
  });
  if (c.reference && c.reference.value > 0) {
    const ry = yOf(c.reference.value);
    page.strokePath([[x, ry], [x + width, ry]], PACE, 0.8, true);
    page.text(x + width, ry - 9, 6.5, c.reference.label, { rgb: PACE, align: "right" });
  }
}

/** Sideways bars: one row a label, one thin bar a series. */
function bars(page: PdfPage, x: number, y: number, width: number, c: ReportChart) {
  if (!c.labels.length || !c.series.length) return;
  const per = c.series.length;
  const rowH = Math.max(13, per * 9 + 4);
  const labelW = width * 0.38;
  const max = Math.max(1, ...c.series.flatMap((s) => s.values.map((v) => Math.max(0, v))));
  let top = y;
  if (per > 1) top += drawLegend(page, x, top, width, c.series.map((s) => s.label));
  c.labels.forEach((label, i) => {
    page.text(x, top + 2, fitSize(label, labelW - 6, 8, false, 5.5), label, { gray: 0.2, bold: c.highlight === i });
    const bh = per > 1 ? 7 : rowH - 5;
    c.series.forEach((s, k) => {
      const val = Math.max(0, s.values[i] ?? 0);
      const bw = Math.max(1, ((width - labelW - 52) * val) / max);
      const by = top + 2 + k * (bh + 2);
      page.fillRectRgb(x + labelW, by, bw, bh, color(k));
      page.text(x + labelW + bw + 4, by + (per > 1 ? -0.5 : 0), per > 1 ? 6.5 : 8, fmt(val), { gray: 0.3 });
    });
    top += rowH;
  });
}

/** Shares of a whole: a pie or a donut, with the legend's values and percents on the right. */
function pie(page: PdfPage, x: number, y: number, width: number, c: ReportChart) {
  const values = (c.series[0]?.values ?? []).map((v) => Math.max(0, v));
  const sum = values.reduce((s, v) => s + v, 0);
  const r = 56;
  const cx = x + r + 4;
  const cy = y + 8 + r;
  if (!sum) {
    page.text(cx, cy - 4, 8, "Nothing in this period", { gray: 0.5, align: "center" });
    return;
  }
  let a = Math.PI / 2;
  values.forEach((v, k) => {
    if (!v) return;
    const b = a - (v / sum) * Math.PI * 2;
    page.fillPath(v === sum ? arc(cx, cy, r, 0, Math.PI * 2) : [[cx, cy], ...arc(cx, cy, r, a, b)], color(k));
    a = b;
  });
  if (c.kind === "donut") {
    page.fillPath(arc(cx, cy, r * 0.55, 0, Math.PI * 2), [1, 1, 1]);
    page.text(cx, cy - 9, fitSize(short(sum), r, 11, true, 6), short(sum), { bold: true, align: "center" });
    page.text(cx, cy + 4, 6.5, "total", { gray: 0.45, align: "center" });
  }
  const lx = x + r * 2 + 28;
  const lw = width - (lx - x);
  c.labels.forEach((label, k) => {
    const ly = y + 6 + k * 13;
    const pct = `${Math.round(((values[k] ?? 0) / sum) * 1000) / 10}%`;
    page.fillRectRgb(lx, ly + 1, 8, 8, color(k));
    page.text(lx + 13, ly, fitSize(label, lw * 0.55, 8, false, 5.5), label, { gray: 0.2 });
    page.text(lx + lw, ly, 8, `${fmt(values[k] ?? 0)}  (${pct})`, { gray: 0.3, align: "right" });
  });
}

/** A half-circle gauge a figure: the year to date as a share of the goal, the pace marked. */
function gauges(page: PdfPage, x: number, y: number, width: number, c: ReportChart) {
  const rows = c.rows ?? [];
  const per = Math.min(4, Math.max(1, rows.length));
  const w = width / per;
  rows.forEach((row, i) => {
    const gx = x + (i % per) * w + w / 2;
    const gy = y + Math.floor(i / per) * 92 + 56;
    const r = Math.min(46, w / 2 - 8);
    const band = (from: number, to: number, fill: Rgb) => page.fillPath([...arc(gx, gy, r, from, to), ...arc(gx, gy, r * 0.62, to, from)], fill);
    band(Math.PI, 0, [0.92, 0.92, 0.92]);
    const share = row.goal ? Math.min(1, Math.max(0, row.value / row.goal)) : 0;
    if (share > 0) band(Math.PI, Math.PI * (1 - share), tone(row.good ?? true));
    if (row.goal && c.pace != null) {
      const a = Math.PI * (1 - Math.min(1, c.pace));
      page.strokePath([[gx + r * 0.55 * Math.cos(a), gy - r * 0.55 * Math.sin(a)], [gx + (r + 4) * Math.cos(a), gy - (r + 4) * Math.sin(a)]], PACE, 1.6);
    }
    page.text(gx, gy - 16, 12, row.goal ? `${Math.round((row.value / row.goal) * 100)}%` : "-", { bold: true, align: "center" });
    page.text(gx, gy + 4, fitSize(row.label, w - 8, 7.5, true, 5), row.label, { bold: true, gray: 0.2, align: "center" });
    page.text(gx, gy + 15, fitSize(row.text ?? "", w - 8, 7, false, 5), row.text ?? "", { gray: 0.4, align: "center" });
    if (row.sub) page.text(gx, gy + 25, fitSize(row.sub, w - 8, 6.5, false, 5), row.sub, { gray: 0.5, align: "center" });
  });
}

/** One row a figure, on its own scale, the period's figure and its variance on the right. With a goal: the year to
 * date (this period darker) towards the goal, the pace marked. Without: this period against the period before (a
 * bar each, so the change shows). Counts and pesos can sit together. */
function scorecard(page: PdfPage, x: number, y: number, width: number, c: ReportChart) {
  const rows = c.rows ?? [];
  const labelW = width * 0.3;
  const barW = width * 0.36;
  const bx = x + labelW;
  const tx = bx + barW + 10;
  const blue = PALETTE[0]!;
  const toGoal = (row: ChartRow) => !!row.goal && row.ytd != null;
  rows.forEach((row, i) => {
    const top = y + i * 30;
    for (const [n, line] of wrap(row.label, labelW - 8, 8).slice(0, 2).entries()) page.text(x, top + 3 + n * 10, 8, line, { gray: 0.15 });
    if (toGoal(row)) {
      const end = Math.max(1, row.goal!, row.ytd!);
      const at = (v: number) => bx + (Math.max(0, v) / end) * barW;
      page.fillRect(bx, top + 4, barW, 10, 0.93);
      page.fillRectRgb(bx, top + 4, at(row.ytd!) - bx, 10, lighten(blue, 0.55));
      page.fillRectRgb(at(row.ytd! - row.value), top + 4, at(row.ytd!) - at(row.ytd! - row.value), 10, blue);
    } else {
      const end = Math.max(1, row.value, row.previous ?? 0) * 1.05;
      const w = (v: number) => (Math.max(0, v) / end) * barW;
      page.fillRectRgb(bx, top + 2, Math.max(1, w(row.value)), 8, blue);
      if (row.previous != null) page.fillRect(bx, top + 11, Math.max(1, w(row.previous)), 5, 0.72);
    }
    if (toGoal(row)) {
      const goal = row.goal!;
      const end = Math.max(1, goal, row.ytd!);
      const at = (v: number) => bx + (Math.max(0, v) / end) * barW;
      page.line(at(goal), top + 1, at(goal), top + 17, 0.1, 1.2);
      if (c.pace != null) {
        const px = at(goal * Math.min(1, c.pace));
        page.fillPath([[px - 3, top - 1], [px + 3, top - 1], [px, top + 4]], PACE);
      }
    }
    page.text(tx, top + 1, fitSize(row.text ?? "", x + width - tx, 8, true, 5.5), row.text ?? "", { bold: true, rgb: row.good == null ? undefined : tone(row.good), gray: 0.15 });
    if (row.sub) page.text(tx, top + 12, fitSize(row.sub, x + width - tx, 7, false, 5), row.sub, { gray: 0.45 });
  });
  // The key, drawn as the shapes it explains.
  const ky = y + rows.length * 30 + 2;
  let kx = x;
  const key = (draw: () => void, label: string) => {
    draw();
    page.text(kx + 11, ky, 6.5, label, { gray: 0.45 });
    kx += textWidth(label, 6.5) + 24;
  };
  key(() => page.fillRectRgb(kx, ky + 1, 8, 6, blue), "this period");
  if (rows.some((r) => !toGoal(r) && r.previous != null)) key(() => page.fillRect(kx, ky + 2, 8, 4, 0.72), "the period before");
  if (rows.some(toGoal)) {
    key(() => page.fillRectRgb(kx, ky + 1, 8, 6, lighten(blue, 0.55)), "year to date before this period");
    key(() => page.line(kx + 4, ky, kx + 4, ky + 8, 0.1, 1.2), "goal");
    if (c.pace != null) key(() => page.fillPath([[kx + 1, ky + 1], [kx + 7, ky + 1], [kx + 4, ky + 6]], PACE), "where the year's pace puts it");
  }
}

/** The change from the period before a figure, in percent, around a centre line: green good, red bad. */
function variance(page: PdfPage, x: number, y: number, width: number, c: ReportChart) {
  const rows = c.rows ?? [];
  const labelW = width * 0.34;
  const cx = x + labelW + (width - labelW) / 2;
  const half = (width - labelW) / 2 - 36;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  page.line(cx, y, cx, y + rows.length * 15, 0.6);
  rows.forEach((row, i) => {
    const top = y + i * 15;
    page.text(x, top + 3, fitSize(row.label, labelW - 6, 8, false, 5.5), row.label, { gray: 0.2 });
    const w = (Math.abs(row.value) / max) * half;
    const fill = tone(row.good);
    if (row.value >= 0) {
      page.fillRectRgb(cx, top + 3, Math.max(1, w), 9, fill);
      page.text(cx + w + 4, top + 3, 7.5, row.text ?? `${row.value}%`, { rgb: fill });
    } else {
      page.fillRectRgb(cx - w, top + 3, Math.max(1, w), 9, fill);
      page.text(cx - w - 4, top + 3, 7.5, row.text ?? `${row.value}%`, { rgb: fill, align: "right" });
    }
  });
}

/** Big numbers: a tile a figure with its change. */
function kpis(page: PdfPage, x: number, y: number, width: number, c: ReportChart) {
  const rows = c.rows ?? [];
  const per = Math.min(4, Math.max(1, rows.length));
  const gap = 8;
  const w = (width - gap * (per - 1)) / per;
  rows.forEach((row, i) => {
    const tx = x + (i % per) * (w + gap);
    const ty = y + Math.floor(i / per) * 50;
    page.fillRect(tx, ty, w, 44, 0.96);
    page.fillRectRgb(tx, ty, 3, 44, tone(row.good ?? null));
    page.text(tx + 9, ty + 6, fitSize(row.label, w - 14, 7.5, false, 5), row.label, { gray: 0.45 });
    page.text(tx + 9, ty + 17, fitSize(row.text ?? "", w - 14, 15, true, 7), row.text ?? "", { bold: true });
    if (row.sub) page.text(tx + 9, ty + 34, fitSize(row.sub, w - 14, 7, false, 5), row.sub, { rgb: tone(row.good ?? null) });
  });
}

/** A graph alone as SVG (the report on screen, the graph builder's preview), drawn as the PDF draws it. */
export function chartSvg(c: ReportChart, width = 507): string {
  const page = new PdfPage();
  const h = drawChart(page, 0, 0, width, c);
  return regionSvg(page, -4, -4, width + 8, h + 8);
}
