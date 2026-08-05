import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background p-6">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-64 sm:h-80">
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="h-full w-full">
          <path
            d="M0,160 C240,100 480,220 720,160 C960,100 1200,220 1440,160 L1440,320 L0,320 Z"
            className="fill-accent/60"
          />
          <path
            d="M0,224 C240,180 480,260 720,224 C960,180 1200,260 1440,224 L1440,320 L0,320 Z"
            className="fill-accent"
          />
        </svg>
      </div>

      <div className="relative z-10 flex w-full flex-col items-center gap-6">
        {children}
        <p className="text-xs text-muted-foreground">© 2025 Little Ark Foundation. All rights reserved.</p>
      </div>
    </div>
  );
}
