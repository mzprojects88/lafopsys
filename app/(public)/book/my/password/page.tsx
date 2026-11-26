import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/modules/bookings/portal-forms";
import { ui } from "@/components/modules/bookings/public-ui";
import { portalSession } from "@/lib/booking/portal";

export const dynamic = "force-dynamic";

/** Volunteers Portal: choose the group's own password (0182). Required after the one-time password. */
export default async function SetPasswordPage() {
  const session = await portalSession();
  if (!session) redirect("/book/sign-in");
  return (
    <section className={ui.card}>
      <p className={ui.eyebrow}>Volunteers Portal</p>
      <h1 className={ui.h1}>{session.setupOnly ? "Choose your password" : "Change your password"}</h1>
      <p className={ui.lead}>
        {session.setupOnly ? "The one-time password works only once. Choose a password of your own to sign in from now on." : "Choose a new password. You will stay signed in here, and be signed out everywhere else."}
      </p>
      <SetPasswordForm />
    </section>
  );
}
