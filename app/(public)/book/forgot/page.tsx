import { redirect } from "next/navigation";
import { ForgotForm } from "@/components/modules/bookings/portal-forms";
import { ui } from "@/components/modules/bookings/public-ui";
import { emailReady } from "@/lib/notify/email";

export const dynamic = "force-dynamic";

/** Volunteers Portal: a new one-time password by email (step 4). Only while email is set up on the hosting. */
export default function ForgotPage() {
  if (!emailReady()) redirect("/book/sign-in");
  return (
    <section className={ui.card}>
      <p className={ui.eyebrow}>Volunteers Portal</p>
      <h1 className={ui.h1}>A new one-time password</h1>
      <p className={ui.lead}>Type the email address your group books with. If it has the Volunteers Portal, we email it a one-time password; your current password keeps working until you choose a new one.</p>
      <ForgotForm />
    </section>
  );
}
