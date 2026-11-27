import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { bookingSiteAllows } from "@/lib/utils/booking";

/**
 * The public booking site (book.littlearkfoundation.org) is this same app deployed as its own Vercel project with
 * BOOKING_SITE_ONLY=1: there only the booking pages and their API answer; the staff app, cron jobs and every other
 * route are "not found". "/" opens the booking page.
 */
export async function proxy(request: NextRequest) {
  if (process.env.BOOKING_SITE_ONLY === "1") {
    const path = request.nextUrl.pathname;
    if (path === "/") return NextResponse.redirect(new URL("/book", request.url));
    if (!bookingSiteAllows(path)) return new NextResponse("Not found", { status: 404 });
    return NextResponse.next();
  }
  // Admin-only modules (lib/rbac/hidden.ts) are checked inside, once the session says who is asking.
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, and common static asset extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
