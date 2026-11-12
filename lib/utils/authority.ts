/**
 * Who signs a request (polish 4, Financial Settings › Authority): for a requester's role and an amount, each step's
 * signers by the same rules the database signs by (ops.voucher_may_sign / voucher_may_pay): a row covers an amount
 * from its lower bound to under its upper one; endorsement is per role, and a row with nobody means none is needed;
 * an urgent approver signs only urgent requests. A step nobody covers would leave the request waiting forever.
 */
export interface AuthorityRow {
  step: string;
  requester_role?: string | null;
  min_amount?: number | string | null;
  max_amount?: number | string | null;
  staff_id?: string | null;
  alternate_staff_id?: string | null;
  urgent?: boolean | null;
}

export const SIGN_STEPS = [
  { step: "endorse", label: "Endorse" },
  { step: "validate", label: "Prepare (Finance)" },
  { step: "review", label: "Review" },
  { step: "approve", label: "Approve" },
  { step: "approve_payment", label: "Approve the payment" },
  { step: "release", label: "Release" },
] as const;

export interface StepSigners {
  step: string;
  label: string;
  /** The people who may sign it (signers and alternates), in the rows' order. */
  signers: string[];
  /** Endorsement this role doesn't need. */
  notNeeded: boolean;
}

export function whoSigns(rows: readonly AuthorityRow[], role: string, amount: number, urgent = false): StepSigners[] {
  const covers = (r: AuthorityRow) => amount >= Number(r.min_amount ?? 0) && (r.max_amount == null || r.max_amount === "" || amount < Number(r.max_amount));
  return SIGN_STEPS.map(({ step, label }) => {
    const hits = rows.filter((r) => r.step === step && covers(r) && (step !== "endorse" || r.requester_role === role) && (!r.urgent || urgent));
    const signers = [...new Set(hits.flatMap((r) => [r.staff_id, r.alternate_staff_id]).filter((x): x is string => !!x))];
    return { step, label, signers, notNeeded: step === "endorse" && hits.length > 0 && hits.every((r) => !r.staff_id) };
  });
}
