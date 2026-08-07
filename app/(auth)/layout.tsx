import type { ReactNode } from "react";
import { AuthBackdrop } from "@/components/layout/auth-backdrop";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthBackdrop>{children}</AuthBackdrop>;
}
