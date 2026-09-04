"use client";

import * as React from "react";

/**
 * The current time, re-read every `intervalMs`. For anything that has to keep
 * moving on its own -- an open clock session's elapsed hours -- without a
 * data change to trigger a render. Only use in components that render nothing
 * until their data has loaded, so the first client render never has to match
 * a server-rendered timestamp.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
