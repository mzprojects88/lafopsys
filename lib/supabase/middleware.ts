import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/env";

// /api/calendar/sync checks a bearer secret itself: the scheduled job that
// calls it has no session, and a redirect to /login would be silent.
const PUBLIC_PATHS = ["/login", "/impact", "/portal/login", "/api/calendar/sync"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isPortalPath(pathname: string): boolean {
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

// Real Supabase Auth sign-in is now wired up (app/(auth)/login) and verified
// end-to-end against the live database, so enforcement is on. (This was
// deliberately staged off while /login was still the old "any 6-digit PIN
// works" demo — flipping it on before a real login page existed would have
// locked every route behind a login screen that could never succeed.)
const ENFORCE_AUTH = true;

/**
 * Refreshes the Supabase session on every request and — once ENFORCE_AUTH is
 * flipped on — redirects unauthenticated users to /login for any non-public
 * route. lafopsys had zero route protection before this (any URL was reachable
 * regardless of "role", client-side-only mock auth); this is the real
 * enforcement point, staged in deliberately rather than turned on all at once.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Do not remove — refreshes the auth token, required for SSR session continuity.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const onPortalPath = isPortalPath(pathname);

  if (ENFORCE_AUTH && !user && !isPublicPath(pathname)) {
    const loginUrl = new URL(onPortalPath ? "/portal/login" : "/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Real server-side separation between staff and donor sessions, now that
  // both share the same Supabase Auth `authenticated` pool. `app_metadata`
  // is set once at account-creation time (createStaffAccount never sets it;
  // createDonorPortalAccount sets `{ portal: "donor" }`) and isn't
  // client-writable, so it can be trusted here without a DB round trip on
  // every request. This is routing/defense-in-depth, not the real security
  // boundary -- RLS (supabase/migrations/0023) is what actually stops a
  // donor session from reading staff-only data; this just keeps a
  // legitimate session from landing in the wrong UI. Deliberately NOT the
  // client-side-only `localStorage` gate the deleted /partners hospital
  // portal used (zero server-side enforcement) -- this checks a real
  // Supabase Auth JWT via auth.getUser() above, same as the staff check.
  if (user) {
    const isDonor = user.app_metadata?.portal === "donor";
    if (isDonor && !onPortalPath && !isPublicPath(pathname)) {
      return NextResponse.redirect(new URL("/portal/dashboard", request.url));
    }
    if (!isDonor && onPortalPath && pathname !== "/portal/login") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}
