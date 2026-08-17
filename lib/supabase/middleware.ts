import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/impact"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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

  if (ENFORCE_AUTH && !user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
