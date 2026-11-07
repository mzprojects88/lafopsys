import type { ReactNode } from "react";
import { AuthBackdrop } from "@/components/layout/auth-backdrop";
import pkg from "@/package.json";

// Staff sign-in and change PIN show which build is running (Jesse's request, 2026-10-13): the version he sets in
// package.json, read here on the server and passed down as a string (the donor portal's layout is a client component,
// so the frame itself never imports package.json).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthBackdrop version={pkg.version}>{children}</AuthBackdrop>;
}
