import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { openaiApiKey, openaiModel } from "./env";

/**
 * The one door to OpenAI. Every use in the app is a small, structured
 * question with a schema-checked answer -- no chat, no free text into the
 * database. What leaves the system is decided per function and kept to the
 * minimum the question needs.
 */

let provider: ReturnType<typeof createOpenAI> | null = null;

function model() {
  if (!provider) provider = createOpenAI({ apiKey: openaiApiKey() });
  return provider(openaiModel());
}

const MATCH_TIMEOUT_MS = 20_000;

export interface MatchCandidate {
  /** Server-side handle; the model sees only a letter. */
  id: string;
  name: string;
  carerNames: string[];
  birthYear: number | null;
  province: string | null;
}

export interface MatchQuestion {
  sheetName: string;
  sheetCarer: string | null;
  sheetRelationship: string | null;
  candidates: MatchCandidate[];
}

export interface MatchAnswer {
  decision: "match" | "none" | "unsure";
  /** The chosen candidate's id (mapped back from the letter), when decision is "match". */
  patientId: string | null;
  confidence: number;
  reason: string;
}

const answerSchema = z.object({
  decision: z.enum(["match", "none", "unsure"]),
  choice: z.string().nullable().describe("The letter of the matching candidate, or null"),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300),
});

const LETTERS = "ABCDEFGHIJ";

/**
 * Is a name typed on the house roster one of these patient records?
 * The model sees the roster's name and carer, and per candidate a letter,
 * the name, carer names, birth year and province -- no ids, numbers,
 * addresses or anything clinical. Filipino spelling habits are spelled out
 * in the instructions so "Arione" against "Arionne" is judged the way a
 * social worker would judge it.
 */
export async function adjudicatePatientMatch(q: MatchQuestion): Promise<MatchAnswer> {
  if (q.candidates.length === 0) return { decision: "none", patientId: null, confidence: 1, reason: "No similar names on file." };
  const lines = q.candidates.slice(0, LETTERS.length).map((c, i) => {
    const bits = [c.name];
    if (c.carerNames.length > 0) bits.push(`carer: ${c.carerNames.join(" / ")}`);
    if (c.birthYear) bits.push(`born ${c.birthYear}`);
    if (c.province) bits.push(c.province);
    return `${LETTERS[i]}. ${bits.join(" · ")}`;
  });
  const prompt = [
    `Roster entry: patient "${q.sheetName}"${q.sheetCarer ? `, carer "${q.sheetCarer}"` : ""}${q.sheetRelationship ? ` (${q.sheetRelationship})` : ""}.`,
    "",
    "Candidates on file:",
    ...lines,
    "",
    "Is the roster entry one of the candidates? Answer match with the letter when one candidate is clearly the same child; none when no candidate is; unsure when two candidates could be.",
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MATCH_TIMEOUT_MS);
  try {
    const { object } = await generateObject({
      model: model(),
      schema: answerSchema,
      system:
        "You match names typed by hand on a Philippine children's shelter roster against patient records. " +
        "Names are Filipino: 'Last, First' order, middle names and suffixes (Jr., DC., initials) are often omitted on the roster, " +
        "spelling varies by a letter or two (Kieth/Keith, Arione/Arionne, ñ/n), and all-caps is common. " +
        "The same surname with a different first name is a different child (siblings are common). " +
        "A matching carer name is strong evidence; a different carer is weak evidence against. Be decisive on obvious spelling variants and cautious otherwise.",
      prompt,
      abortSignal: controller.signal,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    const idx = object.choice ? LETTERS.indexOf(object.choice.trim().toUpperCase().charAt(0)) : -1;
    const chosen = idx >= 0 && idx < q.candidates.length ? q.candidates[idx] : null;
    if (object.decision === "match" && !chosen) {
      return { decision: "unsure", patientId: null, confidence: Math.min(object.confidence, 0.5), reason: `${object.reason} (no valid candidate letter)` };
    }
    return {
      decision: object.decision,
      patientId: object.decision === "match" ? (chosen?.id ?? null) : null,
      confidence: object.confidence,
      reason: object.reason,
    };
  } finally {
    clearTimeout(timer);
  }
}

const CHANGES_TIMEOUT_MS = 45_000;

export interface SheetChangeItem {
  /** Server-side handle; the model sees only a number. */
  id: string;
  label: string;
  before: string | null;
  after: string;
  appNow: string | null;
}

export interface SheetChangeAnswer {
  id: string;
  summary: string;
  /** typo = a spelling fix; format = the same value written differently; real = new information; serious = a change a person must confirm (a death, a changed identity). */
  flag: "typo" | "format" | "real" | "serious";
}

const changesSchema = z.object({
  items: z.array(
    z.object({
      n: z.number().int(),
      summary: z.string().max(240),
      flag: z.enum(["typo", "format", "real", "serious"]),
    })
  ),
});

/**
 * What changed on LAF's original Patients Database sheet, in words a social
 * worker can act on (user, 2026-09-24: the app is the record; the sheet's
 * edits are reviewed, not copied). Each item is one field of one child,
 * with no name, number or other context attached -- the model sees the
 * field's label and its old, new and current-app values, nothing else.
 */
export async function explainSheetChanges(items: SheetChangeItem[]): Promise<SheetChangeAnswer[]> {
  if (items.length === 0) return [];
  const lines = items.map(
    (it, i) => `${i + 1}. ${it.label}: the sheet said "${it.before ?? "(nothing)"}", now says "${it.after}"; the app has "${it.appNow ?? "(nothing)"}".`
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHANGES_TIMEOUT_MS);
  try {
    const { object } = await generateObject({
      model: model(),
      schema: changesSchema,
      system:
        "You review edits made on a Philippine children's shelter spreadsheet so a social worker can decide whether to copy each one into the patient system. " +
        "For each numbered change write one short plain-English sentence saying what changed and what applying it would do to the system's value, and give a flag: " +
        "typo = a spelling or typing fix of the same thing; format = the same value written differently (a phone losing its leading 0, dates, capitals, an abbreviation like 'BCell ALL' for Acute Lymphoblastic Leukemia); " +
        "real = genuinely new or different information; serious = a change that must be confirmed before applying (status Expired, a changed name or birthday, a different carer). " +
        "Names are Filipino; statuses are On-going Treatment, Expired, Non-Pedia, Check Up. Never invent facts beyond the values given.",
      prompt: `Changes:\n${lines.join("\n")}\n\nAnswer every number.`,
      abortSignal: controller.signal,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    return object.items
      .filter((a) => a.n >= 1 && a.n <= items.length)
      .map((a) => ({ id: items[a.n - 1].id, summary: a.summary, flag: a.flag }));
  } finally {
    clearTimeout(timer);
  }
}

const PLAN_TIMEOUT_MS = 30_000;

export interface BedPlanPerson {
  /** Server-side handle (a stay id, or "new" for the family arriving); the model sees a letter. */
  id: string;
  sex: "F" | "M" | null;
  familyTag: string | null;
  nightsHere: number | null;
  leavesInDays: number | null;
  /** "B6 (Room 2)", or null for the family arriving. */
  now: string | null;
}

export interface BedPlanOption {
  moves: { personId: string; to: string }[];
}

export interface BedPlanChoice {
  /** Index into the options given. */
  index: number;
  /** Refers to families as "Family A"...; `letters` says who each is, so the app can put names back. */
  explanation: string;
  /** Per person id, why they move. */
  reasons: Record<string, string>;
  /** Letter -> person id. */
  letters: Record<string, string>;
}

const planSchema = z.object({
  choice: z.number().int().min(1),
  explanation: z.string().max(500),
  reasons: z.array(z.object({ person: z.string(), reason: z.string().max(160) })),
});

/**
 * Which of these rule-valid bed plans a house social worker would choose,
 * and why, in plain words (bed rules, 0070/0071). Every plan already keeps
 * the rules -- the app found them and checks the chosen one again -- so the
 * model only weighs the families: letters, woman or man carer, a family tag,
 * nights in the house and days to check-out. No names, no health data.
 */
export async function chooseBedPlan(people: BedPlanPerson[], options: BedPlanOption[]): Promise<BedPlanChoice> {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const letterOf = new Map(people.map((p, i) => [p.id, letters[i] ?? `P${i}`]));
  const idOf = new Map([...letterOf].map(([id, l]) => [l, id]));
  const who = people.map((p) => {
    const bits = [p.sex === "F" ? "woman carer" : p.sex === "M" ? "man carer" : "carer's sex unknown"];
    if (p.familyTag) bits.push(`family ${p.familyTag}`);
    if (p.id === "new") bits.push("ARRIVING now, needs a bed");
    else {
      if (p.nightsHere !== null) bits.push(`${p.nightsHere} night(s) in the house`);
      if (p.leavesInDays !== null) bits.push(p.leavesInDays <= 0 ? "leaving today" : `leaving in ${p.leavesInDays} day(s)`);
      if (p.now) bits.push(`now in ${p.now}`);
    }
    return `${letterOf.get(p.id)}: ${bits.join(", ")}`;
  });
  const plans = options.map(
    (o, i) => `Plan ${i + 1}: ${o.moves.map((m) => `${letterOf.get(m.personId)} -> ${m.to}`).join("; ") || "(no moves)"}`
  );
  const prompt = ["Families:", ...who, "", "Plans (every one keeps the house rules):", ...plans, "", "Choose one plan."].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAN_TIMEOUT_MS);
  try {
    const { object } = await generateObject({
      model: model(),
      schema: planSchema,
      system:
        "You help the social worker of a Philippine house for children in cancer treatment and their carers decide bed moves. " +
        "Rooms are for women carers or men carers (one family may share); Room 1 fills first. Every plan given already follows these rules. " +
        "Choose the kindest plan, the way a hospital bed manager would: fewest moves; move recent arrivals rather than families settled for many nights; " +
        "avoid moving a family leaving today or tomorrow; keep a family together. " +
        "Explain the choice in two or three short plain sentences for the social worker, always calling a family \"Family A\", \"Family B\" and so on, and give one short reason per family that moves (without its letter).",
      prompt,
      abortSignal: controller.signal,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    const index = object.choice - 1 >= 0 && object.choice - 1 < options.length ? object.choice - 1 : 0;
    const reasons: Record<string, string> = {};
    for (const r of object.reasons) {
      const id = idOf.get(r.person.trim().toUpperCase().charAt(0));
      if (id) reasons[id] = r.reason;
    }
    return { index, explanation: object.explanation, reasons, letters: Object.fromEntries(idOf) };
  } finally {
    clearTimeout(timer);
  }
}

const PHOTO_TIMEOUT_MS = 25_000;

export interface OdometerRead {
  /** Whole km, or null when the model can't read it. */
  reading: number | null;
  confidence: number;
  note: string;
}

const odometerSchema = z.object({
  reading: z.number().int().min(0).nullable().describe("The total distance in whole km, or null if unreadable"),
  confidence: z.number().min(0).max(1),
  note: z.string().max(160),
});

/**
 * The odometer in a photo of a vehicle's dashboard (Fuel Monitoring, 0078).
 * Only the image goes out -- not the vehicle, the driver or the last
 * reading, so the model reads what it sees instead of agreeing with us; the
 * app compares afterwards and the driver confirms.
 */
export async function readOdometerPhoto(jpeg: Uint8Array): Promise<OdometerRead> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS);
  try {
    const { object } = await generateObject({
      model: model(),
      schema: odometerSchema,
      instructions:
        "You read vehicle odometers from photos taken by a driver in the Philippines. " +
        "Report the TOTAL distance (ODO) in whole kilometres: ignore the trip meters (TRIP A/B), the clock, the fuel and temperature gauges, " +
        "and a final tenths digit (often a differently coloured last drum or after a decimal point). " +
        "If the odometer is not in the photo, or a digit cannot be read with certainty, give null and say why in the note. Never guess digits.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What does the odometer read?" },
            { type: "file", data: jpeg, mediaType: "image/jpeg" },
          ],
        },
      ],
      abortSignal: controller.signal,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    return { reading: object.reading, confidence: object.confidence, note: object.note };
  } finally {
    clearTimeout(timer);
  }
}

export interface ReceiptRead {
  /** One of the kind ids offered, or null. */
  kind: string | null;
  amount: number | null;
  litres: number | null;
  /** yyyy-MM-dd, or null. */
  date: string | null;
  vendor: string | null;
  confidence: number;
}

const receiptSchema = z.object({
  kind: z.string().nullable().describe("The id of the matching type from the list, or null"),
  amount: z.number().positive().nullable().describe("The total paid, in pesos"),
  litres: z.number().positive().nullable().describe("Litres of fuel, for a fuel receipt"),
  date: z.string().nullable().describe("The receipt's date as yyyy-MM-dd"),
  vendor: z.string().max(80).nullable().describe("The station or shop name and branch"),
  confidence: z.number().min(0).max(1),
});

/**
 * A fuel or vehicle-expense receipt, read to prefill the form (0078): the
 * driver checks every field before saving. The model gets the image and the
 * list of expense types; it is told to leave out card numbers and names.
 */
export async function readReceiptPhoto(jpeg: Uint8Array, kinds: { id: string; name: string }[]): Promise<ReceiptRead> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS);
  try {
    const { object } = await generateObject({
      model: model(),
      schema: receiptSchema,
      instructions:
        "You read Philippine receipts for a children's charity's vehicle: fuel (Petron, Shell, Caltex, Seaoil, Phoenix, Cleanfuel...), oil changes, tires, repairs, parking, tolls, car washes, LTO registration. " +
        "Give the TOTAL amount paid in pesos (not VAT lines or change), the litres for fuel, the date as yyyy-MM-dd, and the station or shop name with its branch. " +
        "Choose the expense type id from the list given, or null. Use null for anything you cannot read with certainty. Never return card numbers or personal names.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Expense types (id: name):\n${kinds.map((k) => `${k.id}: ${k.name}`).join("\n")}\n\nRead this receipt.` },
            { type: "file", data: jpeg, mediaType: "image/jpeg" },
          ],
        },
      ],
      abortSignal: controller.signal,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    const kind = object.kind && kinds.some((k) => k.id === object.kind) ? object.kind : null;
    const date = object.date && /^\d{4}-\d{2}-\d{2}$/.test(object.date) ? object.date : null;
    return { kind, amount: object.amount, litres: object.litres, date, vendor: object.vendor, confidence: object.confidence };
  } finally {
    clearTimeout(timer);
  }
}

const DONOR_TIMEOUT_MS = 60_000;

export interface DonorNameItem {
  /** Server-side handle; the model sees only a number. */
  id: string;
  name: string;
  type: string;
}

export interface DonorNameAnswer {
  id: string;
  name: string;
  salutation: string | null;
  type: "individual" | "corporate" | "foundation" | "government" | "anonymous";
  /** Only a given name or a nickname ("Ma'am Grace"): staff must supply the full name. */
  incomplete: boolean;
  note: string;
}

const donorNamesSchema = z.object({
  items: z.array(
    z.object({
      n: z.number().int(),
      name: z.string().max(200),
      salutation: z.string().max(20).nullable(),
      type: z.enum(["individual", "corporate", "foundation", "government", "anonymous"]),
      incomplete: z.boolean(),
      note: z.string().max(200),
    })
  ),
});

/**
 * LAF's donor names written the way the foundation decided (2026-10-07): people in Title Case
 * with Filipino particles lower-case inside a name ("Juan dela Cruz") and titles moved to a
 * salutation; organisations as registered (acronyms kept, "Corp.", "Inc."); a household or group
 * ("Juan & Maria Santos", "Garcia Family & Friends") stays one donor, type individual. The model
 * sees each donor's name and current type only -- no email, phone, TIN or gift.
 */
export async function reviewDonorNames(items: DonorNameItem[]): Promise<DonorNameAnswer[]> {
  if (items.length === 0) return [];
  // The current type is not shown: the model anchored on it ("individual" for a lodge, 2026-10-08 test).
  const lines = items.map((it, i) => `${i + 1}. ${it.name}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DONOR_TIMEOUT_MS);
  try {
    const { object } = await generateObject({
      model: model(),
      schema: donorNamesSchema,
      system:
        "You tidy the donor register of a Philippine children's charity. For each numbered donor return how the name should be written and what kind of donor it is. " +
        "People: Title Case; Filipino surname particles (de, dela, del, delos, de los, de la) lower-case when inside a name ('Juan dela Cruz'); suffixes 'Jr.', 'Sr.', 'III'; middle initials 'C.'; " +
        "a leading title (Mr., Mrs., Ms., Ma'am, Sir, Dr., Atty., Engr., Hon., Rev., Fr.) goes to salutation and out of the name, except for couples or lists of people, where titles stay in the name. " +
        "Organisations: as registered -- keep acronyms in capitals (BDO, AFC, NU, DSWD), legal suffixes as 'Corp.', 'Inc.', 'Co.', 'Ltd.'; don't expand or invent words. " +
        "Types: individual = a person, a family, a couple, a group of friends or supporters; corporate = a company or business; foundation = a nonprofit, church, school, university, club, lodge, fraternity, alumni batch or association; " +
        "government = a government office or LGU; anonymous = explicitly anonymous. " +
        "incomplete = true only for a person given by a first name or nickname alone (e.g. 'Ma'am Grace', 'Sir Eli'). " +
        "Hard rules: for a single person the returned name never starts with a title -- the title goes in salutation (input 'Ma'am Grace' -> name 'Grace', salutation \"Ma'am\"). " +
        "Decide the type from the name itself; most names of companies, schools, churches, lodges, fraternities and clubs are NOT individual. " +
        "Examples: 'AFC FOODS' -> 'AFC Foods', corporate. 'MASONIC COREGIDOR LODGE' -> 'Masonic Coregidor Lodge', foundation. 'ALPHA PHI OMEGA' -> 'Alpha Phi Omega', foundation. " +
        "'National University Fairview' -> foundation. 'DJ Meleya Supporters' -> individual. 'Kristine S. Co' -> individual (Co is a surname). 'MR. AND MRS. DE JESUS' -> 'Mr. and Mrs. de Jesus', salutation null. " +
        "Never change the spelling of a real name or merge different people; if unsure, keep the name as given and say so in note. note: under 15 words, empty if nothing changed.",
      prompt: `Donors:\n${lines.join("\n")}\n\nAnswer every number.`,
      abortSignal: controller.signal,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    return object.items
      .filter((a) => a.n >= 1 && a.n <= items.length)
      .map((a) => ({ id: items[a.n - 1].id, name: a.name.trim(), salutation: a.salutation?.trim() || null, type: a.type, incomplete: a.incomplete, note: a.note }));
  } finally {
    clearTimeout(timer);
  }
}

export interface DonorPair {
  id: string;
  a: string;
  b: string;
}

export interface DonorPairAnswer {
  id: string;
  same: "yes" | "no" | "unsure";
  reason: string;
}

const donorPairsSchema = z.object({
  items: z.array(z.object({ n: z.number().int(), same: z.enum(["yes", "no", "unsure"]), reason: z.string().max(200) })),
});

/** Are two near-identical donor names the same donor (a typo, a dropped initial) or two people? Names only. */
export async function judgeDonorPairs(pairs: DonorPair[]): Promise<DonorPairAnswer[]> {
  if (pairs.length === 0) return [];
  const lines = pairs.map((p, i) => `${i + 1}. "${p.a}"  vs  "${p.b}"`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DONOR_TIMEOUT_MS);
  try {
    const { object } = await generateObject({
      model: model(),
      schema: donorPairsSchema,
      system:
        "Each numbered line is two donor names from a Philippine charity's register that look alike. Say whether they are the same donor written two ways " +
        "(a typo, capitals, a missing middle initial, a title, a missing hyphen, 'Corp' vs 'Corp.') -> yes; clearly different people or organisations (different first names, e.g. 'Iya' vs 'IQ', siblings sharing a surname) -> no; otherwise unsure. " +
        "reason: under 15 words.",
      prompt: `Pairs:\n${lines.join("\n")}\n\nAnswer every number.`,
      abortSignal: controller.signal,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    return object.items.filter((a) => a.n >= 1 && a.n <= pairs.length).map((a) => ({ id: pairs[a.n - 1].id, same: a.same, reason: a.reason }));
  } finally {
    clearTimeout(timer);
  }
}
