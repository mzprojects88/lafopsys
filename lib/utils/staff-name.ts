/**
 * How a staff name prints on a document (0094): the full name alone, or the full name with the
 * job title (shared.staff.position; HR's documents use HR's record). Chosen per document type in
 * Settings > Documents. Pure, relative-free, so tests/ can load it.
 */
export type NameFormat = "name" | "name_title";

/** The documents that print a staff name, and how each prints today (the default). The
 * Certificate of employment and BIR 2316 are not here: their wording is fixed (the certificate
 * states the position by law; the BIR form has a name box only). */
export const NAME_DOCUMENTS = [
  { key: "cash_ar", title: "Cash acknowledgment receipt", who: "Received for LAF", default: "name_title" },
  { key: "donee_cert", title: "Donee certificate (BIR 2322)", who: "Authorised representative", default: "name_title" },
  { key: "dtr", title: "Daily Time Record", who: "Employee", default: "name_title" },
  { key: "manifest", title: "Pick-up manifest", who: "Driver", default: "name" },
  { key: "payslip", title: "Payslip", who: "Employee", default: "name_title" },
] as const satisfies readonly { key: string; title: string; who: string; default: NameFormat }[];

export type NameDocument = (typeof NAME_DOCUMENTS)[number]["key"];

/** The format Settings chose for a document, or its default. */
export function nameFormat(saved: unknown, doc: NameDocument): NameFormat {
  const value = saved && typeof saved === "object" ? (saved as Record<string, unknown>)[doc] : undefined;
  return value === "name" || value === "name_title" ? value : NAME_DOCUMENTS.find((d) => d.key === doc)!.default;
}

/** The job title to print under or after the name, or null when the document shows the name only. */
export function titleFor(format: NameFormat, title: string | null | undefined): string | null {
  return format === "name_title" ? title?.trim() || null : null;
}
