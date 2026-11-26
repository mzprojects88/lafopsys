import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/modules/bookings/portal-forms";
import { StatusPill, ui } from "@/components/modules/bookings/public-ui";
import { portalHome, portalSession, type PortalVisit } from "@/lib/booking/portal";
import { longDate } from "@/lib/utils/booking-emails";
import { formatTime12 } from "@/lib/utils/time12";

export const dynamic = "force-dynamic";

function Visit({ v, upcoming }: { v: PortalVisit; upcoming: boolean }) {
  const namesWanted = upcoming && v.status === "approved" && v.namesGiven < v.volunteersCount;
  return (
    <li className="rounded-2xl border border-[#c7dce9] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[15px] font-bold text-[#082f59]">
          {longDate(v.date)} · {formatTime12(v.start)} to {formatTime12(v.end)}
        </p>
        <StatusPill status={v.status} />
      </div>
      <p className="mt-1 text-[15px] leading-snug">
        {v.place}
        {v.activities.length ? ` · ${v.activities.join(", ")}` : ""}
      </p>
      <p className="mt-1 text-[13px] text-[#557086]">
        {v.cameCount !== null ? `${v.cameCount} of ${v.volunteersCount} volunteers came · ${v.hours ?? 0} h` : `${v.namesGiven} of ${v.volunteersCount} volunteers named`} · Request ID {v.ref}
      </p>
      {namesWanted ? (
        <p className="mt-2 rounded-xl bg-[#fff6dd] px-3 py-2 text-[14px] text-[#082f59]">
          Please give your volunteers&apos; names and emails by {longDate(v.namesDue)}.
        </p>
      ) : null}
      <Link href={`/book/track?ref=${encodeURIComponent(v.ref)}`} className={`${ui.secondary} mt-3`}>
        {namesWanted ? "Give the names" : "See this booking"}
      </Link>
    </li>
  );
}

/**
 * Volunteers Portal, Home (0182): the group's visits to come, with what is waiting on the group, and its history.
 * The group is the session's, never one named in the address.
 */
export default async function PortalHomePage() {
  const session = await portalSession();
  if (!session) redirect("/book/sign-in");
  if (session.setupOnly) redirect("/book/my/password");
  const home = await portalHome(session.groupId);
  if (!home) redirect("/book/sign-in");
  const held = home.history.filter((v) => v.status === "completed");
  return (
    <div className="flex flex-col gap-6">
      <section className={ui.card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={ui.eyebrow}>Volunteers Portal</p>
            <h1 className={ui.h1}>{home.group.name}</h1>
            <p className={ui.lead}>
              {home.group.contactPerson} · {home.group.email}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/book/my/password" className={ui.secondary}>
              Change password
            </Link>
            <SignOutButton />
          </div>
        </div>
        <ul className="mt-5 flex flex-wrap gap-2 text-[13px] font-bold text-[#082f59]">
          <li className="rounded-full border border-[#c7dce9] bg-white px-3.5 py-1.5">{held.length} visit{held.length === 1 ? "" : "s"} held</li>
          <li className="rounded-full border border-[#c7dce9] bg-white px-3.5 py-1.5">{home.upcoming.length} coming</li>
          <li className="rounded-full border border-[#c7dce9] bg-white px-3.5 py-1.5">{held.reduce((n, v) => n + (v.cameCount ?? 0), 0)} volunteers came</li>
        </ul>
        <a href="/book" className={`${ui.cta} mt-6`}>
          Book a visit
        </a>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Coming up</h2>
        {home.upcoming.length ? (
          <ul className="mt-4 flex flex-col gap-3">
            {home.upcoming.map((v) => (
              <Visit key={v.ref} v={v} upcoming />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[15px]">No visit is coming up. Choose a day on the booking page.</p>
        )}
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>History of events</h2>
        {home.history.length ? (
          <ul className="mt-4 flex flex-col gap-3">
            {home.history.map((v) => (
              <Visit key={v.ref} v={v} upcoming={false} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[15px]">Your past visits will be listed here.</p>
        )}
      </section>
    </div>
  );
}
