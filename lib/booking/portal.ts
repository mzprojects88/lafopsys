import "server-only";
import { cookies } from "next/headers";
import { hashPassword, makeToken, normalizeOtp, otpHash, passwordProblem, sameHash, sha256hex, verifyPassword } from "@/lib/booking/portal-crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BookingStatus } from "@/lib/types/booking";

/**
 * The Volunteers Portal on the server (0182). A group's contact signs in with the group's email and a password (the
 * one-time password staff issued, then one of the group's own). The browser holds a random token in an httpOnly
 * cookie; the database keeps only its hash. Every read takes the group from the session, never from the request.
 * Tables are reached with the service key only; a volunteer never holds a database key.
 */

export const PORTAL_COOKIE = "laf_portal";
const SESSION_DAYS = 30;
const SETUP_MINUTES = 30;

export interface PortalSession {
  sessionId: string;
  groupId: string;
  /** Opened with the one-time password: it may only set the group's own password. */
  setupOnly: boolean;
}

const db = () => createAdminClient().schema("booking");

async function setCookie(token: string, expires: Date) {
  (await cookies()).set(PORTAL_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires });
}

async function openSession(groupId: string, setupOnly: boolean): Promise<void> {
  const token = makeToken();
  const expires = new Date(Date.now() + (setupOnly ? SETUP_MINUTES * 60_000 : SESSION_DAYS * 86_400_000));
  const { error } = await db().from("portal_sessions").insert({ group_id: groupId, token_hash: sha256hex(token), setup_only: setupOnly, expires_at: expires.toISOString() });
  if (error) throw new Error("The session could not be opened.");
  await setCookie(token, expires);
}

/** The session of this browser, or null (no cookie, ended, expired, or the group is locked). */
export async function portalSession(): Promise<PortalSession | null> {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const { data: s } = await db().from("portal_sessions").select("id, group_id, setup_only, expires_at, ended_at, last_seen_at").eq("token_hash", sha256hex(token)).maybeSingle();
  if (!s || s.ended_at || Date.parse(s.expires_at) <= Date.now()) return null;
  const { data: a } = await db().from("portal_accounts").select("locked").eq("group_id", s.group_id).maybeSingle();
  if (!a || a.locked) return null;
  // At most one write a few minutes, not one per page.
  if (!s.last_seen_at || Date.now() - Date.parse(s.last_seen_at) > 5 * 60_000) await db().from("portal_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", s.id);
  return { sessionId: s.id as string, groupId: s.group_id as string, setupOnly: s.setup_only === true };
}

/**
 * The one guard of every portal data action (step 3 onward): a full session of an unlocked group, never one opened
 * with the one-time password (that may only set a password). The group always comes from here, never from a request.
 */
export async function requireGroupSession(): Promise<PortalSession | null> {
  const session = await portalSession();
  return session && !session.setupOnly ? session : null;
}

const WRONG = "That email address and password do not match. Check them, or ask Little Ark Foundation for a new one-time password.";
/** Checked against when there is no password to check, so every failed sign-in takes about the same time. */
const DUMMY_HASH = hashPassword("not a password anyone has");

/** Signs in with the group's email and a password. One message for every failure, so emails cannot be probed. */
export async function signIn(emailTyped: string, password: string, caller: string): Promise<{ ok: true; setupOnly: boolean } | { ok: false; error: string; status: number }> {
  const email = emailTyped.trim().toLowerCase().slice(0, 200);
  const client = createAdminClient();
  const [{ data: byCaller }, { data: byEmail }] = await Promise.all([
    client.schema("booking").rpc("within_limit", { p_kind: "portal-signin", p_key: caller, p_max: 10, p_window: "1 hour" }),
    client.schema("booking").rpc("within_limit", { p_kind: "portal-signin-email", p_key: email || "-", p_max: 8, p_window: "1 hour" }),
  ]);
  if (byCaller === false || byEmail === false) return { ok: false, error: "Too many tries. Please wait an hour and try again.", status: 429 };
  if (!email || !password || password.length > 200) return { ok: false, error: WRONG, status: 400 };
  const { data: group } = await db().from("groups").select("id").eq("email", email).maybeSingle();
  // Read even when the email is unknown (an id that matches nothing), so both paths take the same steps.
  const { data: a } = await db().from("portal_accounts").select("password_hash, otp_hash, otp_expires_at, otp_used_at, must_set_password, locked").eq("group_id", group?.id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  const hasPassword = !!(a && !a.locked && a.password_hash && !a.must_set_password);
  const passwordOk = verifyPassword(password, hasPassword ? a?.password_hash : DUMMY_HASH) && hasPassword;
  if (!group || !a || a.locked) return { ok: false, error: WRONG, status: 400 };
  if (passwordOk) {
    await db().from("portal_accounts").update({ last_sign_in_at: new Date().toISOString() }).eq("group_id", group.id);
    await openSession(group.id as string, false);
    return { ok: true, setupOnly: false };
  }
  const otpOk = normalizeOtp(password).length === 10 && !a.otp_used_at && a.otp_expires_at && Date.parse(a.otp_expires_at) > Date.now() && sameHash(a.otp_hash, otpHash(password));
  if (otpOk) {
    // It works once: used up now, so the same one-time password never opens a second session.
    const now = new Date().toISOString();
    const { data: claimed } = await db().from("portal_accounts").update({ last_sign_in_at: now, otp_used_at: now }).eq("group_id", group.id).is("otp_used_at", null).select("group_id");
    if (!claimed?.length) return { ok: false, error: WRONG, status: 400 };
    await openSession(group.id as string, true);
    return { ok: true, setupOnly: true };
  }
  return { ok: false, error: WRONG, status: 400 };
}

/** The group sets its own password. The one-time password is used up, every other session ends, and this one is
 * replaced by a new full session. */
export async function setPassword(session: PortalSession, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  const now = new Date().toISOString();
  const { error } = await db().from("portal_accounts").update({ password_hash: hashPassword(password), must_set_password: false, password_set_at: now, otp_hash: null, updated_at: now }).eq("group_id", session.groupId);
  if (error) return { ok: false, error: "The password was not saved. Please try again." };
  await db().from("portal_sessions").update({ ended_at: now }).eq("group_id", session.groupId).is("ended_at", null);
  await openSession(session.groupId, false);
  return { ok: true };
}

/** Signing out ends every open session of the group (every device). */
export async function signOut(session: PortalSession | null): Promise<void> {
  if (session) await db().from("portal_sessions").update({ ended_at: new Date().toISOString() }).eq("group_id", session.groupId).is("ended_at", null);
  (await cookies()).delete(PORTAL_COOKIE);
}

export interface PortalVisit {
  ref: string;
  date: string;
  start: string;
  end: string;
  status: BookingStatus;
  place: string;
  activities: string[];
  volunteersCount: number;
  namesGiven: number;
  namesDue: string;
  cameCount: number | null;
  hours: number | null;
  /** Completed and still inside the days the group may confirm who came. */
  canConfirm: boolean;
  /** The last day the group may confirm who came (completed visits). */
  confirmUntil: string | null;
  /** Who was named for the visit (completed visits only): whether each came. */
  members: { id: string; name: string; under18: boolean; came: boolean }[];
}

export interface PortalHome {
  group: { name: string; contactPerson: string; email: string };
  upcoming: PortalVisit[];
  history: PortalVisit[];
}

/** What the group sees: its own bookings, upcoming and past. */
export async function portalHome(groupId: string): Promise<PortalHome | null> {
  const { data: g } = await db().from("groups").select("name, contact_person, email").eq("id", groupId).maybeSingle();
  if (!g) return null;
  const [{ data: rows }, { data: st }, { data: places }] = await Promise.all([
    db().from("requests").select("id, ref, date, start_time, end_time, status, place_id, volunteers_count, attended_hours").eq("group_id", groupId).order("date", { ascending: false }).limit(200),
    db().from("settings").select("names_due_days, attendance_days").maybeSingle(),
    db().from("places").select("id, name"),
  ]);
  const ids = (rows ?? []).map((r) => r.id as string);
  const [{ data: items }, { data: members }] = ids.length
    ? await Promise.all([db().from("request_items").select("request_id, position, activity").in("request_id", ids), db().from("volunteers").select("id, request_id, position, name, under_18, came").in("request_id", ids)])
    : [{ data: [] }, { data: [] }];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const due = Number(st?.names_due_days ?? 3);
  const window = Number(st?.attendance_days ?? 7);
  const addDays = (day: string, n: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const visits: PortalVisit[] = (rows ?? []).map((r) => {
    const mine = (members ?? []).filter((m) => m.request_id === r.id);
    const d = new Date(`${r.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - due);
    return {
      ref: r.ref as string,
      date: r.date as string,
      start: String(r.start_time).slice(0, 5),
      end: String(r.end_time).slice(0, 5),
      status: r.status as BookingStatus,
      place: (places ?? []).find((p) => p.id === r.place_id)?.name ?? "",
      activities: (items ?? []).filter((i) => i.request_id === r.id).sort((a, b) => a.position - b.position).map((i) => i.activity as string),
      volunteersCount: Number(r.volunteers_count),
      namesGiven: mine.length,
      namesDue: d.toISOString().slice(0, 10),
      cameCount: r.status === "completed" ? mine.filter((m) => m.came !== false).length : null,
      hours: r.status === "completed" ? Number(r.attended_hours ?? 0) : null,
      canConfirm: r.status === "completed" && today <= addDays(r.date as string, window),
      confirmUntil: r.status === "completed" ? addDays(r.date as string, window) : null,
      members:
        r.status === "completed"
          ? mine.sort((a, b) => a.position - b.position).map((m) => ({ id: m.id as string, name: m.name as string, under18: m.under_18 === true, came: m.came !== false }))
          : [],
    };
  });
  const coming = (v: PortalVisit) => (v.status === "pending" || v.status === "approved") && v.date >= today;
  return {
    group: { name: g.name as string, contactPerson: g.contact_person as string, email: g.email as string },
    upcoming: visits.filter(coming).sort((a, b) => a.date.localeCompare(b.date)),
    history: visits.filter((v) => !coming(v)),
  };
}

/** The group confirms or corrects who came (booking.portal_attendance checks the visit is the group's, recorded, and
 * still inside the window). Ticks are member ids with came; additions are full name, email and under 18. */
export async function confirmAttendance(session: PortalSession, ref: string, marks: { id: string; came: boolean }[], added: { name: string; email: string; under18: boolean }[]): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { error } = await db().rpc("portal_attendance", { p_group: session.groupId, p_ref: ref, p: { marks, added } });
  if (!error) return { ok: true };
  const shown = error.code === "22023" || error.code === "P0002";
  if (!shown) console.error(`[portal] attendance: ${error.code ?? ""} ${error.message}`);
  return { ok: false, error: shown ? error.message : "Something went wrong on our side. Please try again in a few minutes.", status: shown ? 400 : 500 };
}

/** The people of the group's latest earlier visit, to offer on the names step of one of its bookings: full name,
 * email and under 18. Only for the group's own booking, so nobody with just a Request ID sees an email. */
export async function lastMembers(session: PortalSession, ref: string): Promise<{ name: string; email: string; under18: boolean }[] | null> {
  const { data: r } = await db().from("requests").select("id, date, group_id").eq("ref", ref.toUpperCase().replace(/\s+/g, "")).maybeSingle();
  if (!r || r.group_id !== session.groupId) return null;
  const { data: earlier } = await db().from("requests").select("id").eq("group_id", session.groupId).neq("id", r.id).lte("date", r.date).order("date", { ascending: false }).limit(20);
  for (const e of earlier ?? []) {
    const { data: people } = await db().from("volunteers").select("name, email, under_18, position").eq("request_id", e.id).order("position");
    if (people?.length) return people.filter((p) => p.email).map((p) => ({ name: p.name as string, email: p.email as string, under18: p.under_18 === true }));
  }
  return [];
}

/** The group's details, to fill in a new booking made from the portal. */
export async function groupDetails(session: PortalSession): Promise<{ name: string; kind: string; contactPerson: string; email: string; mobile: string } | null> {
  const { data: g } = await db().from("groups").select("name, kind, contact_person, email, mobile").eq("id", session.groupId).maybeSingle();
  return g ? { name: g.name as string, kind: g.kind as string, contactPerson: g.contact_person as string, email: (g.email as string) ?? "", mobile: (g.mobile as string) ?? "" } : null;
}
