"use client";

import * as React from "react";
import { Role, ROLES } from "@/lib/types/common";

const STORAGE_KEY = "laf-active-role";

interface RoleContextValue {
  role: Role;
  setRole: (role: Role) => void;
  user: string;
}

const RoleContext = React.createContext<RoleContextValue | undefined>(undefined);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = React.useState<Role>("admin");

  React.useEffect(() => {
    // localStorage only exists client-side, so the persisted role can't be read
    // during the initial (SSR-matching) render — this syncs it in on mount.
    const stored = window.localStorage.getItem(STORAGE_KEY) as Role | null;
    if (stored && ROLES.some((r) => r.value === stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external source (localStorage), not derivable during render
      setRoleState(stored);
    }
  }, []);

  const setRole = React.useCallback((next: Role) => {
    setRoleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const user = ROLES.find((r) => r.value === role)?.sampleUser ?? "Demo User";

  const value = React.useMemo(() => ({ role, setRole, user }), [role, setRole, user]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = React.useContext(RoleContext);
  if (!ctx) {
    throw new Error("useRole must be used within a RoleProvider");
  }
  return ctx;
}
