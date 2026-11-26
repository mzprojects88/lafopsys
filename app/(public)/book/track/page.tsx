import { TrackBooking } from "@/components/modules/bookings/track-booking";
import { requireGroupSession } from "@/lib/booking/portal";

export const dynamic = "force-dynamic";

/**
 * A group's own page for its booking (0172): it types its Request ID and sees the booking, its status and, once
 * approved, the instructions and who to coordinate with; it gives its volunteers' names there and may cancel.
 * The Request ID in the link of an email fills the box by itself.
 */
export default async function TrackPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const { ref } = await searchParams;
  const signedIn = !!(await requireGroupSession());
  return <TrackBooking initialRef={typeof ref === "string" ? ref.slice(0, 40) : ""} signedIn={signedIn} />;
}
