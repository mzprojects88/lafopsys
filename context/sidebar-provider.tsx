"use client";

import * as React from "react";

/**
 * Desktop sidebar state (TailAdmin's SidebarContext, trimmed; the same as
 * LAF Inventory's): expanded or rail, plus a hover-expand while it is a rail.
 * Persisted so someone who collapses it keeps it collapsed. Phones never
 * render the sidebar.
 */
interface SidebarState {
  expanded: boolean;
  hovered: boolean;
  toggle: () => void;
  setHovered: (v: boolean) => void;
}

const SidebarContext = React.createContext<SidebarState | null>(null);
const KEY = "lafopsys:sidebar-expanded";

const listeners = new Set<() => void>();
function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Read through useSyncExternalStore so the server renders "expanded" and
  // the client corrects itself without a setState-in-effect.
  const expanded = React.useSyncExternalStore(subscribe, readExpanded, () => true);
  const [hovered, setHovered] = React.useState(false);

  const toggle = React.useCallback(() => {
    try {
      window.localStorage.setItem(KEY, readExpanded() ? "0" : "1");
    } catch {
      // storage unavailable: the toggle is a no-op
    }
    listeners.forEach((cb) => cb());
  }, []);

  const value = React.useMemo(() => ({ expanded, hovered, toggle, setHovered }), [expanded, hovered, toggle]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used inside SidebarProvider");
  return ctx;
}
