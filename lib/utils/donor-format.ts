import type { DonorType } from "@/lib/types/donor";

/**
 * How LAF writes donor names (decided 2026-10-07):
 *   - people in Title Case, Filipino name particles lower-case inside a name ("Juan dela Cruz"),
 *     titles moved out to a salutation ("Mr.", "Ma'am"), suffixes as "Jr." / "III";
 *   - organisations as registered: acronyms kept (BDO, DSWD), legal suffixes tidied ("Corp.", "Inc.");
 *   - a household ("Juan & Maria Santos") stays one donor.
 * Rules only: anything they can't settle (a person or a company? a one-word name?) is flagged for
 * the AI or for staff, never guessed.
 */
export interface FormattedName {
  name: string;
  salutation: string | null;
  kind: "person" | "organisation" | "government";
  suggestedType: DonorType;
  /** One given name only ("Ma'am Grace"): the full name has to come from staff. */
  incomplete: boolean;
}

const SALUTATIONS: [RegExp, string][] = [
  [/^mrs\.?$/i, "Mrs."], [/^mr\.?$/i, "Mr."], [/^ms\.?$/i, "Ms."], [/^miss$/i, "Ms."],
  [/^ma'?am$/i, "Ma'am"], [/^madam$/i, "Ma'am"], [/^sir$/i, "Sir"], [/^dr\.?$/i, "Dr."],
  [/^engr\.?$/i, "Engr."], [/^atty\.?$/i, "Atty."], [/^hon\.?$/i, "Hon."], [/^rev\.?$/i, "Rev."], [/^fr\.?$/i, "Fr."],
];
const SUFFIXES: Record<string, string> = { jr: "Jr.", sr: "Sr.", ii: "II", iii: "III", iv: "IV", v: "V" };
const PARTICLES = new Set(["de", "del", "dela", "delos", "della", "di", "da", "van", "von", "y", "la", "las", "los", "le"]);
const LEGAL: Record<string, string> = { corp: "Corp.", corporation: "Corporation", inc: "Inc.", incorporated: "Incorporated", co: "Co.", ltd: "Ltd.", llc: "LLC", company: "Company", opc: "OPC" };
const ACRONYMS = new Set(["bdo", "bpi", "sm", "dswd", "lgu", "ncr", "pgh", "nch", "up", "ust", "dlsu", "admu", "pcso", "rcbc", "ph", "usa", "us", "jci", "abs", "cbn", "gma", "pldt", "doh", "deped", "bir", "sss", "pnb", "lbp", "dbp", "ofw", "rotc", "uerm", "feu", "pup", "ama", "ceu"]);
// Strong signs only: a "Students Government" or a "University" is a school, not government.
const GOVERNMENT = /\b(lgu|barangay|brgy|municipality|municipal|city of|province of|provincial|dswd|doh|deped|pcso|philhealth|department of|office of the|senate|congress)\b/i;
const NONPROFIT = /\b(foundation|church|ministry|ministries|parish|chapel|mission|lodge|club|association|assoc|society|school|university|college|academy|alumni|rotary|lions|jaycees|charity|charities|org|organization|organisation|fellowship|guild|order|council|batch)\b/i;
// No "co" (Co is a Chinese-Filipino surname) and no "friends"/"family"/"supporters": a group of
// people stays an individual (household) donor.
const COMPANY = /\b(corp|corporation|inc|incorporated|company|ltd|llc|opc|enterprise|enterprises|distributors?|trading|industries|holdings|ventures|solutions|services|store|mart|restaurant|cafe|bakery|pharmacy|bank|clinic|hospital|hotel|realty|motors|marketing|food|foods|supply|supplies|construction|systems|bpo)\b/i;

/** First letter up, the rest down, past any leading bracket or quote: "(mama" -> "(Mama". */
const cap = (w: string) => w.toLowerCase().replace(/[a-z]/, (c) => c.toUpperCase());
/** "tuazon-domingo" -> "Tuazon-Domingo", "o'brien" -> "O'Brien", "mcdonald" -> "McDonald". */
function capWord(w: string): string {
  return w
    .split("-")
    .map((part) => part.split("'").map((p) => (/^mc[a-z]{2,}/i.test(p) ? "Mc" + cap(p.slice(2)) : cap(p))).join("'"))
    .join("-");
}

export function formatDonorName(raw: string): FormattedName {
  let text = String(raw ?? "").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim().replace(/[,;:/]+$/, "").trim();
  // Titles at the start become the salutation (only the first one is kept).
  let salutation: string | null = null;
  let words = text.split(" ").filter(Boolean);
  // Several people ("Mr. and Mrs. de Jesus", "Ms. A, Mr. B"): their titles stay in the name.
  const several = /\s(&|and)\s/i.test(` ${text} `) || (text.match(/,/g) ?? []).length >= 1;
  while (!several && words.length > 1) {
    const hit = SALUTATIONS.find(([re]) => re.test(words[0]!.replace(/[.,]$/, "") + (words[0]!.endsWith(".") ? "." : "")) || re.test(words[0]!));
    if (!hit) break;
    salutation ??= hit[1];
    words = words.slice(1);
  }
  text = words.join(" ");

  const kind: FormattedName["kind"] = GOVERNMENT.test(text) ? "government" : NONPROFIT.test(text) || COMPANY.test(text) ? "organisation" : "person";
  const suggestedType: DonorType = kind === "government" ? "government" : kind === "person" ? "individual" : NONPROFIT.test(text) ? "foundation" : "corporate";
  const shouting = text === text.toUpperCase() && /[A-Z]{2}/.test(text);

  let name: string;
  if (kind === "person") {
    name = words
      .map((w, i) => {
        const bare = w.replace(/\.$/, "").toLowerCase();
        const title = SALUTATIONS.find(([re]) => re.test(w.replace(/,$/, "")));
        if (title) return title[1] + (w.endsWith(",") ? "," : "");
        // "V." in the middle is an initial; only the last word can be a suffix (Jr., III).
        if (i > 0 && i === words.length - 1 && SUFFIXES[bare] && !(bare === "v" && w.endsWith("."))) return SUFFIXES[bare];
        if (/^[a-z]\.?$/i.test(w)) return w[0]!.toUpperCase() + "."; // a middle initial
        // Initials written on purpose (JM, IQ) stay, unless the whole name was typed in capitals.
        if (!shouting && /^[A-Z]{2,4}$/.test(w)) return w;
        if (shouting && words.length === 1 && w.length <= 5) return w; // "BNI": a one-word acronym
        if (w === "&" || /^and$/i.test(w)) return w === "&" ? "&" : "and";
        if (i > 0 && i < words.length - 1 && PARTICLES.has(bare)) return bare;
        return capWord(w);
      })
      .join(" ");
  } else {
    name = words
      .map((w) => {
        const bare = w.replace(/[.,]$/, "").toLowerCase();
        if (LEGAL[bare]) return LEGAL[bare];
        if (ACRONYMS.has(bare)) return bare.toUpperCase();
        // Organisations keep their own capitals unless the whole name was typed in capitals.
        if (!shouting) return w;
        if (/^[A-Z]{2,4}$/.test(w) && !/[AEIOU]/.test(w)) return w; // BDO-like, no vowels
        if (/^[A-Z]{2,3}$/.test(w) && !["THE", "OF", "AND", "FOR", "SAN", "DE", "LA"].includes(w)) return w; // AFC, NU, BK
        return capWord(w);
      })
      .join(" ");
  }
  const personWords = kind === "person" ? words.filter((w) => w !== "&" && !/^and$/i.test(w)) : words;
  return { name, salutation, kind, suggestedType, incomplete: kind === "person" && personWords.length < 2 };
}
