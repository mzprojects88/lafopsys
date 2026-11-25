import type { BookingStatus } from "@/lib/types/booking";
import { BOOKING_STATUS_LABEL } from "@/lib/utils/booking";

/**
 * The look of the public booking pages, in the foundation's brand (navy headings, Ark Blue actions, one yellow call
 * to action a page, pills and soft rounded cards). Colours are written out so the pages never follow ArkOS's theme.
 */
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0068c9]";
const field = "mt-1.5 w-full rounded-xl border border-[#c7dce9] bg-white px-3 text-base text-[#082f59] placeholder:text-[#557086]/60 focus:border-[#0068c9] focus:ring-2 focus:ring-[#0068c9]/25 focus:outline-none disabled:bg-[#f2f9fd]";

export const ui = {
  card: "rounded-3xl border border-[#c7dce9] bg-white p-5 sm:p-8",
  eyebrow: "text-[13px] font-bold tracking-wide text-[#0068c9] uppercase",
  h1: "mt-1 text-3xl leading-[1.05] font-black text-[#082f59] sm:text-4xl",
  h2: "text-xl leading-tight font-black text-[#082f59]",
  lead: "mt-3 max-w-prose text-base leading-relaxed",
  label: "block text-sm font-bold text-[#082f59]",
  hint: "mt-1 text-[13px] leading-snug text-[#557086]",
  input: `${field} h-11`,
  area: `${field} min-h-20 py-2 leading-snug`,
  cta: `inline-flex min-h-12 items-center justify-center rounded-full bg-[#ffc83d] px-8 py-3 text-sm font-black tracking-wide text-[#082f59] uppercase shadow-[0_6px_16px_rgba(8,47,89,0.18)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 ${focus}`,
  primary: `inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#0068c9] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#005ba8] disabled:cursor-not-allowed disabled:opacity-60 ${focus}`,
  secondary: `inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-2 border-[#0068c9] bg-white px-5 py-2 text-sm font-bold text-[#0068c9] transition hover:bg-[#edf8ff] disabled:cursor-not-allowed disabled:opacity-60 ${focus}`,
  problem: "rounded-2xl border border-[#d92d20]/30 bg-[#fef3f2] p-4 text-sm leading-relaxed text-[#912018]",
  soft: "rounded-2xl bg-[#f2f9fd] p-4 text-[15px] leading-relaxed whitespace-pre-line",
};

const PILL: Record<BookingStatus, string> = {
  pending: "bg-[#ffc83d] text-[#082f59]",
  approved: "bg-[#0068c9] text-white",
  completed: "bg-[#082f59] text-white",
  declined: "border border-[#c7dce9] bg-white text-[#436077]",
  cancelled: "border border-[#c7dce9] bg-white text-[#436077]",
  no_show: "border border-[#c7dce9] bg-white text-[#436077]",
};

export function StatusPill({ status }: { status: BookingStatus }) {
  return <span className={`inline-flex items-center rounded-full px-3.5 py-1 text-[13px] font-bold tracking-wide uppercase ${PILL[status]}`}>{BOOKING_STATUS_LABEL[status]}</span>;
}
