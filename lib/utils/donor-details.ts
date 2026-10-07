import type { Donor, DonorType } from "@/lib/types/donor";

/** What staff type when adding or editing a donor. */
export interface DonorInput {
  name: string;
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
    email: raw.email.trim(),
    phone: raw.phone.trim(),
    tin: raw.tin.trim(),
  };
  if (value.name.length < 2) return { ok: false, error: "Enter the donor's name." };
  if (value.name.length > 200) return { ok: false, error: "The name is too long (200 characters at most)." };
  if (value.email && (value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))) return { ok: false, error: "That email address doesn't look right." };
  if (value.phone && !/^[0-9+()\-\s]{7,30}$/.test(value.phone)) return { ok: false, error: "Phone: digits, spaces, + ( ) and - only." };
  if (value.tin && !/^[0-9\-\s]{9,20}$/.test(value.tin)) return { ok: false, error: "TIN: 9 to 15 digits, dashes allowed (e.g. 123-456-789-000)." };
  return { ok: true, value };
}
