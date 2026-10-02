"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/rbac/use-role";
import { ROLES } from "@/lib/types/common";

/** What the header and the phone account sheet both show about "me". */
export function useAccount() {
  const router = useRouter();
  // The title, not the main role: the CEO (main role Super Admin) shows as CEO (0073).
  const { title, user } = useRole();
  return {
    user,
    roleLabel: ROLES.find((r) => r.value === title)?.label ?? title,
    initials:
      user
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || "?",
    signOut: async () => {
      await createClient().auth.signOut();
      router.push("/login");
    },
  };
}
