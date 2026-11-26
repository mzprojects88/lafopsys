import { NextResponse } from "next/server";
import { callerMark } from "@/lib/booking/server";
import { portalSession, setPassword, signIn, signOut } from "@/lib/booking/portal";

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
    const parsed: unknown = raw.length <= 2_000 ? JSON.parse(raw) : null;
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
  if (body.action === "sign-out") {
    await signOut(session);
    return reply({ ok: true, next: "/book/sign-in" });
  }
  return reply({ ok: false, error: "Unknown request." }, 400);
}
