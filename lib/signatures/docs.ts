// The kinds of generated document a person may allow their signature on (0153). The database checks the same list
// (tests/signatures.test.mjs keeps the two in step). The last two are LAF Inventory's.
export const SIGNATURE_DOCS = [
  { key: "voucher", label: "Payment vouchers", note: "On the steps you signed in ArkOS" },
  { key: "cash_receipt", label: "Cash acknowledgment receipts", note: "Where you received the gift" },
  { key: "donee_certificate", label: "Donee certificates (BIR 2322)", note: "Where you are the certificate signatory" },
  { key: "volunteer_certificate", label: "Volunteer certificates", note: "Where you are the certificate signatory" },
  { key: "nch_billing", label: "NCH billing packages", note: "Where you prepared or approved the bill" },
  { key: "case_record", label: "Case records", note: "Where you prepared, approved or noted the record" },
  { key: "dtr", label: "Daily Time Record prints", note: "On your own time record" },
  { key: "manifest", label: "Trip manifests", note: "Where you are the driver" },
  { key: "report", label: "Report PDFs", note: "On reports you generate (Prepared by)" },
  { key: "gik_receipt", label: "Gifts-in-kind receipts (LAF Inventory)", note: "Where you received the goods" },
  { key: "inventory_report", label: "Inventory reports (LAF Inventory)", note: "Where you are named in the sign-off" },
] as const;

export type SignatureDoc = (typeof SIGNATURE_DOCS)[number]["key"];
export const SIGNATURE_DOC_KEYS: readonly string[] = SIGNATURE_DOCS.map((d) => d.key);
