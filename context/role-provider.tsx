"use client";

import * as React from "react";
import { Role, ROLES } from "@/lib/types/common";
import { createClient } from "@/lib/supabase/client";

const ROLE_STORAGE_KEY = "laf-active-role";
const USER_STORAGE_KEY = "laf-active-user";

interface RoleContextValue {
  role: Role;
  setRole: (role: Role) => void;
  user: string;
  /** Sets role and user independently — used by the login page, where a specific
   * staff member (not just their role's canonical demo sample) signs in. */
  login: (role: Role, user: string) => void;
}

const RoleContext = React.createContext<RoleContextValue | undefined>(undefined);

function sampleUserFor(role: Role) {
  return ROLES.find((r) => r.value === role)?.sampleUser ?? "Demo User";
}

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = React.useState<Role>("admin");
  const [user, setUserState] = React.useState<string>(() => sampleUserFor("admin"));

  React.useEffect(() => {
    // A real Supabase session (set by the real login page) is the source of
    // truth when one exists — it's checked first and, if present, overrides
    // whatever's in localStorage (which could be stale from a prior demo
    // role-switch). Falls back to localStorage only when there's no real
    // session, e.g. local dev before ENFORCE_AUTH is turned on in middleware.
    let cancelled = false;

    async function syncFromSession() {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();

      if (userData.user) {
        const { data: staffRow } = await supabase
          .schema("shared")
          .from("staff")
          .select("role, first_name, last_name")
          .eq("id", userData.user.id)
          .single();

        if (!cancelled && staffRow) {
          const fullName = `${staffRow.first_name} ${staffRow.last_name}`;
          // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external source (Supabase session), not derivable during render
          setRoleState(staffRow.role as Role);
          setUserState(fullName);
          window.localStorage.setItem(ROLE_STORAGE_KEY, staffRow.role);
          window.localStorage.setItem(USER_STORAGE_KEY, fullName);
          return;
        }
      }

      // No real session — fall back to whatever was last locally selected
      // (localStorage only exists client-side, so this can't be read during
      // the initial SSR-matching render).
      const storedRole = window.localStorage.getItem(ROLE_STORAGE_KEY) as Role | null;
      const storedUser = window.localStorage.getItem(USER_STORAGE_KEY);
      if (!cancelled && storedRole && ROLES.some((r) => r.value === storedRole)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external source (localStorage), not derivable during render
        setRoleState(storedRole);
        setUserState(storedUser ?? sampleUserFor(storedRole));
      }
    }

    syncFromSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRole = React.useCallback((next: Role) => {
    const nextUser = sampleUserFor(next);
    setRoleState(next);
    setUserState(nextUser);
    window.localStorage.setItem(ROLE_STORAGE_KEY, next);
    window.localStorage.setItem(USER_STORAGE_KEY, nextUser);
  }, []);

  const login = React.useCallback((nextRole: Role, nextUser: string) => {
    setRoleState(nextRole);
    setUserState(nextUser);
    window.localStorage.setItem(ROLE_STORAGE_KEY, nextRole);
    window.localStorage.setItem(USER_STORAGE_KEY, nextUser);
  }, []);

  const value = React.useMemo(() => ({ role, setRole, user, login }), [role, setRole, user, login]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = React.useContext(RoleContext);
  if (!ctx) {
    throw new Error("useRole must be used within a RoleProvider");
  }
  return ctx;
}
