// The Patient ID card template (0169, owner 21 Nov 2026): one design, set by the Super Admin in Settings,
// used for every child's card. Pure, so the card printer, the maker and tests/ share it. What may change:
// texts, which lines show, the colour theme (LAF palette only) and the print layout. What never changes:
// the size, the QR, the logo and "a photo only with consent".

/** storybook: the owner's sample of 21 Nov 2026 (watercolour sky, rounded tiles); laf_blue / laf_navy: plain cards. */
export type CardThemeKey = "storybook" | "laf_blue" | "laf_navy";
export type CardLayout = "fold" | "duplex";
/** [r, g, b], 0-255. */
export type Rgb255 = [number, number, number];

/**
 * The LAF palette themes. `main` carries the name and the QR (always dark), `band` the footer and the LFCN
 * pill (white text on it), `accent` the title pill (main-coloured text on it), `soft` the photo box and marks.
 */
export const CARD_THEMES: Record<CardThemeKey, { label: string; main: Rgb255; band: Rgb255; accent: Rgb255; soft: Rgb255; rule: Rgb255 }> = {
  // The laf-brand palette only (navy #082f59, Ark Blue #0068c9, Hope Yellow #ffc83d, Pale Sky #edf8ff).
  storybook: { label: "LAF Storybook", main: [8, 47, 89], band: [0, 104, 201], accent: [255, 200, 61], soft: [237, 248, 255], rule: [199, 220, 233] },
  laf_blue: { label: "LAF Blue (plain)", main: [5, 45, 93], band: [0, 91, 168], accent: [255, 200, 61], soft: [242, 249, 253], rule: [227, 238, 247] },
  laf_navy: { label: "LAF Navy (plain)", main: [5, 45, 93], band: [5, 45, 93], accent: [255, 200, 61], soft: [238, 243, 250], rule: [221, 230, 242] },
};

export interface CardTemplate {
  /** The pill at the top right of the front. */
  title: string;
  /** The small line under the QR. */
  qrCaption: string;
  /** The line under the LFCN (the storybook design). */
  scanLine: string;
  show: { caseNumber: boolean; carer: boolean; cardLine: boolean; marks: boolean };
  /** The three service marks at the bottom of the front. */
  marks: [string, string, string];
  /** The two footer lines, front and back. */
  footer: [string, string];
  theme: CardThemeKey;
  back: { heading: [string, string]; intro: string; privacy: string; lost: string; found: string };
  layout: CardLayout;
}

/** The LAF design: the owner's storybook sample of 21 Nov 2026 (the plain 18 Nov card is the "LAF Blue" theme). */
export const DEFAULT_CARD_TEMPLATE: CardTemplate = {
  title: "PATIENT ID",
  qrCaption: "For LAF staff to scan",
  scanLine: "Scan to record a service.",
  show: { caseNumber: true, carer: true, cardLine: true, marks: false },
  marks: ["Admission", "Meals", "Goods"],
  footer: ["Our Children. Our Future.", "littlearkfoundation.org"],
  theme: "storybook",
  back: {
    heading: ["This card belongs to", "Little Ark Foundation"],
    intro: "Show it to LAF staff when you arrive at LAF House, at every meal, and when you receive goods. Staff scan the code to find you.",
    privacy: "The code holds no personal details. It shows nothing unless an LAF staff member is signed in.",
    lost: "Lost or damaged? Tell the social worker. The old card is switched off and a new one is printed.",
    found: "Found this card? Please return it to LAF House",
  },
  layout: "fold",
};

/** The longest each text may be, so it always fits the card. */
export const CARD_TEXT_LIMITS = {
  title: 14,
  qrCaption: 28,
  scanLine: 40,
  mark: 12,
  footer0: 32,
  footer1: 34,
  heading: 26,
  intro: 170,
  privacy: 130,
  lost: 130,
  found: 70,
} as const;

/** A line of text as the card can print it: no control characters, single spaces, cut to the limit. */
const clean = (v: unknown, max: number, fallback: string): string => {
  if (typeof v !== "string") return fallback;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return t;
};
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Any saved value (or none) as a template the printer can trust: unknown keys dropped, texts cleaned and cut to
 * their limits, a missing value from today's design. The title and the footer's first line may not be empty.
 */
export function normalizeCardTemplate(raw: unknown): CardTemplate {
  const d = DEFAULT_CARD_TEMPLATE;
  const r = obj(raw);
  const s = obj(r.show);
  const b = obj(r.back);
  const L = CARD_TEXT_LIMITS;
  const marks = arr(r.marks);
  const footer = arr(r.footer);
  const heading = arr(b.heading);
  return {
    title: clean(r.title, L.title, d.title) || d.title,
    qrCaption: clean(r.qrCaption, L.qrCaption, d.qrCaption),
    scanLine: clean(r.scanLine, L.scanLine, d.scanLine),
    show: { caseNumber: flag(s.caseNumber, d.show.caseNumber), carer: flag(s.carer, d.show.carer), cardLine: flag(s.cardLine, d.show.cardLine), marks: flag(s.marks, d.show.marks) },
    marks: [0, 1, 2].map((i) => clean(marks[i], L.mark, d.marks[i]!)) as CardTemplate["marks"],
    footer: [clean(footer[0], L.footer0, d.footer[0]) || d.footer[0], clean(footer[1], L.footer1, d.footer[1])],
    theme: typeof r.theme === "string" && r.theme in CARD_THEMES ? (r.theme as CardThemeKey) : d.theme,
    back: {
      heading: [clean(heading[0], L.heading, d.back.heading[0]), clean(heading[1], L.heading, d.back.heading[1])],
      intro: clean(b.intro, L.intro, d.back.intro),
      privacy: clean(b.privacy, L.privacy, d.back.privacy),
      lost: clean(b.lost, L.lost, d.back.lost),
      found: clean(b.found, L.found, d.back.found),
    },
    layout: r.layout === "duplex" ? "duplex" : "fold",
  };
}
