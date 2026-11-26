import { redirect } from "next/navigation";

// Answered on each visit, so the forward is an immediate redirect rather than a page that refreshes itself.
export const dynamic = "force-dynamic";

/** Volunteers moved to their own menu, just below Staff & Time (0181, owner 26 Nov 2026). */
export default function OldVolunteersPage() {
  redirect("/volunteers");
}
