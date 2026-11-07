import type { ReactNode } from "react";
import Image from "next/image";

/**
 * The sign-in frame, as in LAF Inventory (staff sign-in, change PIN, the donor
 * portal's sign-in and password change). On a phone the form sits straight on
 * the page above the wave, no card frame. From `lg` up it is TailAdmin's split
 * sign-in: the form on the left, a brand panel on the right with the mark and
 * the one line that says what this is for.
 */
export function AuthBackdrop({
  children,
  panelTitle = "LAF Operating System",
  panelText = "Patients and admissions, staff time, the house, donors and the books of Little Ark Foundation, in one place.",
  version,
}: {
  children: ReactNode;
  panelTitle?: string;
  panelText?: string;
  /** Shown as "ArkOS v…" under the copyright (staff pages only; the donor portal passes none). */
  version?: string;
}) {
  return (
    <div className="relative flex min-h-svh bg-background">
      <div className="relative flex min-h-svh w-full min-w-0 flex-col items-center justify-center overflow-hidden p-6 lg:w-1/2">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-64 sm:h-80 lg:hidden">
          <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="h-full w-full">
            <path d="M0,160 C240,100 480,220 720,160 C960,100 1200,220 1440,160 L1440,320 L0,320 Z" className="fill-accent/60" />
            <path d="M0,224 C240,180 480,260 720,224 C960,180 1200,260 1440,224 L1440,320 L0,320 Z" className="fill-accent" />
          </svg>
        </div>
        <div className="relative z-10 flex w-full flex-col items-center gap-6">
          {children}
          {/* In the page's flow under the form, never pinned to the screen (it used to overlap on phones). */}
          <footer className="flex flex-col items-center gap-0.5 text-center text-theme-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} Little Ark Foundation. All rights reserved.</p>
            {version ? <p>ArkOS v{version}</p> : null}
          </footer>
        </div>
      </div>

      {/* Brand panel colours are fixed (navy in both themes), like inventory's. */}
      <div aria-hidden className="relative hidden w-1/2 items-center justify-center overflow-hidden bg-[#0f2a6b] lg:flex dark:bg-[#0b1f4d]">
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, #2563eb 0, transparent 40%), radial-gradient(circle at 80% 80%, #1d4ed8 0, transparent 45%)" }} />
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-56 w-full opacity-40">
          <path d="M0,160 C240,100 480,220 720,160 C960,100 1200,220 1440,160 L1440,320 L0,320 Z" fill="#2563eb" />
          <path d="M0,224 C240,180 480,260 720,224 C960,180 1200,260 1440,224 L1440,320 L0,320 Z" fill="#3b82f6" />
        </svg>
        <div className="relative flex max-w-sm flex-col items-center gap-6 text-center text-white">
          <Image src="/logo/laf-mark.png" alt="" width={140} height={150} priority className="drop-shadow-lg" />
          <div className="flex flex-col gap-2">
            <p className="text-2xl font-semibold">{panelTitle}</p>
            <p className="text-theme-sm text-white/75">{panelText}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
