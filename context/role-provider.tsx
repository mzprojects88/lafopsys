"use client";

import * as React from "react";
import { Role, ROLES } from "@/lib/types/common";
import { createClient } from "@/lib/supabase/client";
import { resetAllCollections } from "@/lib/data/collection-store";

const ROLE_STORAGE_KEY = "laf-active-role";
const USER_STORAGE_KEY = "laf-active-user";

interface RoleContextValue {
  role: Role;
  setRole: (role: Role) => void;
  user: string;
  /** Supabase Auth user id of the signed-in staff member. `undefined` while the
   * session is still being resolved, `null` when there is no session. Matches
   * shared.staff.id, so hooks can find "me" without their own auth round trip. */
  staffId: string | null | undefined;
  email: string | null;
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
  const [staffId, setStaffId] = React.useState<string | null | undefined>(undefined);
  const [email, setEmail] = React.useState<string | null>(null);
  const currentUserRef = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    // A real Supabase session (set by the real login page) is the source of
    // truth when one exists — it's checked first and, if present, overrides
    // whatever's in localStorage (which could be stale from a prior demo
    // role-switch). Falls back to localStorage only when there's no real
    // session, e.g. local dev before ENFORCE_AUTH is turned on in middleware.
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
          const fullName = `${staffRow.first_name} ${staffRow.last_name}`;
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
        setRoleState(storedRole);
        setUserState(storedUser ?? sampleUserFor(storedRole));
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

  const value = React.useMemo(
    () => ({ role, setRole, user, staffId, email, login }),
    [role, setRole, user, staffId, email, login]
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
