"use client";

import { usePathname } from "next/navigation";
import { HospitalAuthProvider } from "@/context/hospital-auth-provider";
import { HospitalAuthGate } from "@/components/layout/hospital-auth-gate";
import { AuthBackdrop } from "@/components/layout/auth-backdrop";
import { PartnerTopbar } from "@/components/layout/partner-topbar";

export default function PartnersLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/partners/login";

  return (
    <HospitalAuthProvider>
      {isLogin ? (
        <AuthBackdrop>{children}</AuthBackdrop>
      ) : (
        <HospitalAuthGate>
          <div className="flex min-h-svh flex-col bg-muted/30">
            <PartnerTopbar />
            <main className="flex flex-1 flex-col gap-6 p-4 sm:p-6">{children}</main>
          </div>
        </HospitalAuthGate>
      )}
    </HospitalAuthProvider>
  );
}
