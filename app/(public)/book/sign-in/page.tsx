import { redirect } from "next/navigation";
import { SignInForm } from "@/components/modules/bookings/portal-forms";
import { ui } from "@/components/modules/bookings/public-ui";
import { portalSession } from "@/lib/booking/portal";

export const dynamic = "force-dynamic";

/** Volunteers Portal: sign in (0182). A group already signed in goes straight on. */
export default async function SignInPage() {
  const session = await portalSession();
  if (session) redirect(session.setupOnly ? "/book/my/password" : "/book/my");
  return (
    <section className={ui.card}>
      <p className={ui.eyebrow}>Volunteers Portal</p>
      <h1 className={ui.h1}>Sign in</h1>
      <p className={ui.lead}>For a group&apos;s contact person: see your visits, past and coming. The first time, use the one-time password Little Ark Foundation gave you; you then choose your own.</p>
      <SignInForm />
    </section>
  );
}
