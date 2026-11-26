import { NextResponse } from "next/server";
import { callerMark } from "@/lib/booking/server";
import { confirmAttendance, lastMembers, portalSession, requireGroupSession, setPassword, signIn, signOut } from "@/lib/booking/portal";

export const dynamic = "force-dynamic";

const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** A POST from another site is refused: the portal's forms are on this one. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host || new URL(origin).host === request.headers.get("x-forwarded-host");
  } catch {
    return false;
  }
}

/**
 * The Volunteers Portal's one door (0182): sign in, set the group's own password, sign out. Nothing in a reply ever
 * carries a password, a hash or a token; the session lives in an httpOnly cookie.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ ok: false, error: "Please use the form on this page." }, 403);
  const raw = await request.text();
  let body: Record<string, unknown>;
  try {
    // A list of who came, with additions, can be longer than a sign-in.
    const parsed: unknown = raw.length <= 20_000 ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return reply({ ok: false, error: "That could not be read." }, 400);
  }
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

  if (body.action === "sign-in") {
    const r = await signIn(text(body.email, 200), text(body.password, 201), callerMark(request.headers));
    return r.ok ? reply({ ok: true, next: r.setupOnly ? "/book/my/password" : "/book/my" }) : reply({ ok: false, error: r.error }, r.status);
  }
  const session = await portalSession();
  if (body.action === "set-password") {
    if (!session) return reply({ ok: false, error: "Please sign in again." }, 401);
    const r = await setPassword(session, text(body.password, 201));
    return r.ok ? reply({ ok: true, next: "/book/my" }) : reply({ ok: false, error: r.error }, 400);
  }
  if (body.action === "attendance") {
    const group = await requireGroupSession();
    if (!group) return reply({ ok: false, error: "Please sign in again." }, 401);
    const marks = (Array.isArray(body.marks) ? body.marks.slice(0, 100) : []).map((m) => {
      const x = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      return { id: text(x.id, 36), came: x.came === true };
    });
    const added = (Array.isArray(body.added) ? body.added.slice(0, 20) : []).map((m) => {
      const x = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      return { name: text(x.name, 120), email: text(x.email, 200), under18: x.under18 === true };
    });
    const r = await confirmAttendance(group, text(body.ref, 40), marks, added);
    return r.ok ? reply({ ok: true }) : reply({ ok: false, error: r.error }, r.status);
  }
  if (body.action === "last-members") {
    const group = await requireGroupSession();
    if (!group) return reply({ ok: false, error: "Sign in to the Volunteers Portal to use the people from your last visit." }, 401);
    const people = await lastMembers(group, text(body.ref, 40));
    return people ? reply({ ok: true, people }) : reply({ ok: false, error: "That booking is not your group's." }, 404);
  }
  if (body.action === "sign-out") {
    await signOut(session);
    return reply({ ok: true, next: "/book/sign-in" });
  }
  return reply({ ok: false, error: "Unknown request." }, 400);
}
