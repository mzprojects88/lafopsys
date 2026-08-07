"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHospitalAuth } from "@/context/hospital-auth-provider";

const LOGIN_PATH = "/partners/login";

/** Partner hospital users must be logged in to reach any /partners route besides login. */
export function HospitalAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session } = useHospitalAuth();
  const [mounted, setMounted] = React.useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- avoids gating on the pre-localStorage-sync default (logged-out) state
  React.useEffect(() => setMounted(true), []);

  const mustLogin = mounted && !session && pathname !== LOGIN_PATH;

  React.useEffect(() => {
    if (mustLogin) {
      router.replace(LOGIN_PATH);
    }
  }, [mustLogin, router]);

  if (mustLogin) return null;

  return <>{children}</>;
}
