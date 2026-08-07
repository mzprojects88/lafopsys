"use client";

import * as React from "react";

const SESSION_STORAGE_KEY = "laf-hospital-session";

interface HospitalSession {
  hospitalId: string;
  hospitalName: string;
  nurseId: string;
  nurseName: string;
}

interface HospitalAuthContextValue {
  session: HospitalSession | null;
  login: (session: HospitalSession) => void;
  logout: () => void;
}

const HospitalAuthContext = React.createContext<HospitalAuthContextValue | undefined>(undefined);

export function HospitalAuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<HospitalSession | null>(null);

  React.useEffect(() => {
    // localStorage only exists client-side, so the persisted session can't be
    // read during the initial (SSR-matching) render — this syncs it in on mount.
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (raw) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external source (localStorage), not derivable during render
        setSession(JSON.parse(raw) as HospitalSession);
      } catch {
        // ignore corrupt cache, stay logged out
      }
    }
  }, []);

  const login = React.useCallback((next: HospitalSession) => {
    setSession(next);
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const logout = React.useCallback(() => {
    setSession(null);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  const value = React.useMemo(() => ({ session, login, logout }), [session, login, logout]);

  return <HospitalAuthContext.Provider value={value}>{children}</HospitalAuthContext.Provider>;
}

export function useHospitalAuth() {
  const ctx = React.useContext(HospitalAuthContext);
  if (!ctx) {
    throw new Error("useHospitalAuth must be used within a HospitalAuthProvider");
  }
  return ctx;
}
