import { NextResponse, type NextRequest } from "next/server";
import { isHiddenPath } from "@/lib/rbac/hidden";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // A module hidden on this deployment is simply not there (lib/rbac/hidden.ts).
  if (isHiddenPath(request.nextUrl.pathname)) return NextResponse.rewrite(new URL("/_hidden", request.url));
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, and common static asset extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
