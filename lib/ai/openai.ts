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
