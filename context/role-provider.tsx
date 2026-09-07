"use client";

import * as React from "react";
import { Role } from "@/lib/types/common";
import { createClient } from "@/lib/supabase/client";
import { resetAllCollections } from "@/lib/data/collection-store";

interface RoleContextValue {
  role: Role;
  user: string;
  /** Supabase Auth user id of the signed-in staff member. `undefined` while the
   * session is still being resolved, `null` when there is no session. Matches
   * shared.staff.id, so hooks can find "me" without their own auth round trip. */
  staffId: string | null | undefined;
  email: string | null;
  /** Sets role and user for the session that has just been established, so the
   * first render after sign-in is already correct rather than briefly showing
   * the default. The next syncFromSession() confirms it from shared.staff --
   * this is a head start, never a source of truth. */
  login: (role: Role, user: string) => void;
}

const RoleContext = React.createContext<RoleContextValue | undefined>(undefined);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  // Deliberately the lowest-privilege starting point. The real role arrives
  // from shared.staff a moment later; starting at "admin" would flash admin-only
  // navigation at everyone on every page load.
  const [role, setRoleState] = React.useState<Role>("volunteer");
  const [user, setUserState] = React.useState<string>("");
  const [staffId, setStaffId] = React.useState<string | null | undefined>(undefined);
  const [email, setEmail] = React.useState<string | null>(null);
  const currentUserRef = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    // shared.staff is the only source of the role. There used to be a
    // localStorage fallback here, paired with a sidebar dropdown that let
    // anyone pick their own role; both are gone. RLS never believed the
    // client's claim, so no data was ever exposed -- but a stale or chosen
    // role put navigation in front of people that their account could not
    // actually use, which is its own kind of wrong.
    let cancelled = false;
    const supabase = createClient();

    async function syncFromSession() {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;

      currentUserRef.current = userData.user?.id ?? null;
      setStaffId(userData.user?.id ?? null);
      setEmail(userData.user?.email ?? null);

      if (userData.user) {
        const { data: staffRow } = await supabase
          .schema("shared")
          .from("staff")
          .select("role, first_name, last_name")
          .eq("id", userData.user.id)
          .single();

        if (!cancelled && staffRow) {
          setRoleState(staffRow.role as Role);
          setUserState(`${staffRow.first_name} ${staffRow.last_name}`);
          return;
        }
      }

      // Signed out, or signed in with no roster row. Either way there is no
      // role to show; middleware sends anyone without a session to /login.
      if (!cancelled) {
        setRoleState("volunteer");
        setUserState("");
      }
    }

    // When the signed-in user changes without a hard reload (sign out via the
    // topbar is a soft navigation, then someone else signs in), every shared
    // collection must forget the previous person's rows -- several tables are
    // RLS-scoped per user (time_punches, notification prefs).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const next = session?.user?.id ?? null;
      if (event === "INITIAL_SESSION" || next === currentUserRef.current) return;
      currentUserRef.current = next;
      resetAllCollections();
      setStaffId(next);
      setEmail(session?.user?.email ?? null);
      // Supabase warns against calling other client methods synchronously
      // inside this callback; defer the re-sync to the next tick.
      setTimeout(() => {
        if (!cancelled) void syncFromSession();
      }, 0);
    });

    syncFromSession();
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const login = React.useCallback((nextRole: Role, nextUser: string) => {
    setRoleState(nextRole);
    setUserState(nextUser);
  }, []);

  const value = React.useMemo(
    () => ({ role, user, staffId, email, login }),
    [role, user, staffId, email, login]
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = React.useContext(RoleContext);
  if (!ctx) {
    throw new Error("useRole must be used within a RoleProvider");
  }
  return ctx;
}
