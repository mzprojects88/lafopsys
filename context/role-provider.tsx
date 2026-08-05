"use client";

import * as React from "react";
import { Role, ROLES } from "@/lib/types/common";

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
    // localStorage only exists client-side, so the persisted identity can't be
    // read during the initial (SSR-matching) render — this syncs it in on mount.
    const storedRole = window.localStorage.getItem(ROLE_STORAGE_KEY) as Role | null;
    const storedUser = window.localStorage.getItem(USER_STORAGE_KEY);
    if (storedRole && ROLES.some((r) => r.value === storedRole)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external source (localStorage), not derivable during render
      setRoleState(storedRole);
      setUserState(storedUser ?? sampleUserFor(storedRole));
    }
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
