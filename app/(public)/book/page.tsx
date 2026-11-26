import { BookForm } from "@/components/modules/bookings/book-form";
import { groupDetails, requireGroupSession } from "@/lib/booking/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublicBookingForm } from "@/lib/types/booking";

export const dynamic = "force-dynamic";

/**
 * The public booking page (0172): a donor, a person, a company or an institution picks an open slot at the LAF
 * Activity Center, says who is coming and what the group will do, and files a request. What the page offers
 * (places, limits, activity list, the NCH-approved plans, the texts) comes from Booking settings through
 * booking.web_form, read here on the server.
 */
export default async function BookPage() {
  const { data, error } = await createAdminClient().schema("booking").rpc("web_form");
  const form = error ? null : (data as PublicBookingForm | null);
  if (!form || form.places.length === 0) {
    return (
      <section className="rounded-3xl border border-[#c7dce9] bg-white p-6 sm:p-10">
        <h1 className="text-3xl leading-tight font-black text-[#082f59]">Booking is closed for now</h1>
        <p className="mt-3 max-w-prose text-base leading-relaxed">We are not taking new requests at the moment. Please come back soon, or write to us through littlearkfoundation.org.</p>
      </section>
    );
  }
  // Signed in to the Volunteers Portal: the group's details are filled in and its email is fixed, so the request
  // lands in the group. Only from the session, never from the address.
  const session = await requireGroupSession();
  const prefill = session ? await groupDetails(session) : null;
  return <BookForm form={form} prefill={prefill?.email ? prefill : null} />;
}
