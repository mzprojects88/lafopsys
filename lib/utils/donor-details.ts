import type { Donor, DonorType } from "@/lib/types/donor";

/** What staff type when adding or editing a donor. */
export interface DonorInput {
  name: string;
  /** "Mr.", "Ma'am"... (0083); empty for none. */
  salutation: string;
  type: DonorType;
  taxJurisdiction: "PH" | "US";
  email: string;
  phone: string;
  tin: string;
}

/** "Ms. Maria  Santos-Cruz" and "maria santos cruz" are the same donor for duplicate checks. */
export function normalizeDonorName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(mr|mrs|ms|miss|dr|engr|atty|hon)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Other donors that look like the same person or organisation: same name (as above) or same email. */
export function likelyDuplicates(donors: readonly Donor[], input: Pick<DonorInput, "name" | "email">, exceptId?: string): Donor[] {
  const name = normalizeDonorName(input.name);
  const email = input.email.trim().toLowerCase();
  return donors.filter(
    (d) => d.id !== exceptId && ((name !== "" && normalizeDonorName(d.name) === name) || (email !== "" && (d.email ?? "").trim().toLowerCase() === email)),
  );
}

/** Trimmed input, or the first problem with it (shown to the user as is). */
export function checkDonorInput(raw: DonorInput): { ok: true; value: DonorInput } | { ok: false; error: string } {
  const value: DonorInput = {
    ...raw,
    name: raw.name.replace(/\s+/g, " ").trim(),
    salutation: (raw.salutation ?? "").trim(),
    email: raw.email.trim(),
    phone: raw.phone.trim(),
    tin: raw.tin.trim(),
  };
  if (value.name.length < 2) return { ok: false, error: "Enter the donor's name." };
  if (value.name.length > 200) return { ok: false, error: "The name is too long (200 characters at most)." };
  if (value.salutation.length > 20) return { ok: false, error: "The title is too long (e.g. Mr., Ma'am, Dr.)." };
  if (value.email && (value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))) return { ok: false, error: "That email address doesn't look right." };
  if (value.phone && !/^[0-9+()\-\s]{7,30}$/.test(value.phone)) return { ok: false, error: "Phone: digits, spaces, + ( ) and - only." };
  if (value.tin && !/^[0-9\-\s]{9,20}$/.test(value.tin)) return { ok: false, error: "TIN: 9 to 15 digits, dashes allowed (e.g. 123-456-789-000)." };
  return { ok: true, value };
}

/** Letters to change to turn one string into another (stops early past 3). */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** The same words in any order, initials dropped: "Jewel C. Calica" = "Calica, Jewel". */
const wordKey = (name: string) => normalizeDonorName(name).split(" ").filter((w) => w.length > 1).sort().join(" ");

/**
 * Donors that are probably one donor. `sure`: the same name once titles, capitals, punctuation,
 * initials and word order are ignored -- safe for a rule to suggest a merge. `maybe`: names one or
 * two letters apart ("Ansong Ang" / "Anson Ang") -- for the AI and staff to judge.
 */
export function duplicateDonors<T extends { id: string; name: string }>(donors: readonly T[]): { sure: T[][]; maybe: [T, T][] } {
  const groups = new Map<string, T[]>();
  for (const d of donors) {
    const k = wordKey(d.name);
    if (k) groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const sure = [...groups.values()].filter((g) => g.length > 1);
  const keys = [...groups.keys()].filter((k) => k.length >= 8);
  const maybe: [T, T][] = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) if (editDistance(keys[i]!, keys[j]!) <= 2) maybe.push([groups.get(keys[i]!)![0]!, groups.get(keys[j]!)![0]!]);
  return { sure, maybe };
}
