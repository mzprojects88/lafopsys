"use client";

import * as React from "react";

const PREFIX = "laf-mock-store:";

/**
 * A localStorage-backed copy of a seed array, keyed by name. Screens that need
 * their interactions ("approve", "clock out", "mark issued") to feel real use
 * this instead of a real backend — edits persist across navigation within the
 * browser but there is no server, so a different browser/device sees the
 * original seed data again.
 */
export function useLocalCollection<T extends { id: string }>(key: string, seed: T[]) {
  const storageKey = PREFIX + key;
  const [items, setItems] = React.useState<T[]>(seed);

  React.useEffect(() => {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external source (localStorage), not derivable during render
        setItems(JSON.parse(raw) as T[]);
      } catch {
        // ignore corrupt cache, fall back to seed
      }
    }
  }, [storageKey]);

  const persist = React.useCallback(
    (next: T[]) => {
      setItems(next);
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    },
    [storageKey]
  );

  const updateItem = React.useCallback(
    (id: string, patch: Partial<T>) => {
      persist(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    },
    [items, persist]
  );

  const addItem = React.useCallback(
    (item: T) => {
      persist([item, ...items]);
    },
    [items, persist]
  );

  const reset = React.useCallback(() => {
    window.localStorage.removeItem(storageKey);
    setItems(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  return { items, updateItem, addItem, reset, setItems: persist };
}

export function resetAllMockData() {
  Object.keys(window.localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => window.localStorage.removeItem(k));
  window.location.reload();
}
