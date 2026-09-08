import type { ReactNode } from "react";

/** Bare pages meant for the printer: no sidebar, no header, white ground. */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-svh bg-white">{children}</div>;
}
