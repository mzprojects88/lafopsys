"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { todayIso } from "@/lib/utils/date";
import { PRESETS, parsePreset, presetDescription, presetLabel, presetQuery, presetWindow, type PresetKey, type PresetState } from "@/lib/utils/period-presets";

/** The current time, ticking every half minute; null until the page is in the browser, so the server never draws a clock. */
function useNow(): Date | null {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock starts once the page is in the browser
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const storageKey = (page: string) => `laf-period:${page}`;

/**
 * A page's period (Nov 2026), kept in the address (`?period=this_week`, custom adds `from`/`to`) so a link or a
 * reload shows the same figures. With no period in the address, the one last picked on this page on this device
 * comes back; otherwise the page's default. The page must sit inside a React.Suspense (useSearchParams).
 * `remember: false` (the dashboard, 0147): the default is the person's own choice, so the device's last pick isn't kept.
 */
export function usePeriodPresets(page: string, fallback: PresetKey, allowAll = false, remember = true) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const today = todayIso();
  const state = React.useMemo(() => parsePreset((k) => params.get(k), fallback, allowAll), [params, fallback, allowAll]);
  const window = React.useMemo(() => presetWindow(state, today), [state, today]);

  const write = React.useCallback(
    (next: PresetState, keep: boolean) => {
      const q = new URLSearchParams(params.toString());
      for (const k of ["period", "from", "to"]) q.delete(k);
      for (const [k, v] of Object.entries(presetQuery(next))) q.set(k, v);
      if (remember && keep) {
        try {
          window_localStorage()?.setItem(storageKey(page), JSON.stringify(next));
        } catch {
          // Storage blocked (private window): the address still carries the choice.
        }
      }
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [params, pathname, router, page, remember]
  );

  // Once: the period last picked here, when the address doesn't name one.
  const restored = React.useRef(false);
  React.useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (params.get("period") || !remember) return;
    try {
      const saved = JSON.parse(window_localStorage()?.getItem(storageKey(page)) ?? "null") as PresetState | null;
      if (saved && PRESETS.some((p) => p.key === saved.key) && (saved.key !== "all" || allowAll) && saved.key !== fallback) write(saved, false);
    } catch {
      // Nothing usable stored: the default stands.
    }
  }, [params, page, fallback, allowAll, write, remember]);

  return { state, window, label: presetLabel(state, window), setState: (next: PresetState) => write(next, true), today };
}

const window_localStorage = () => (typeof window === "undefined" ? null : window.localStorage);

/**
 * The period chips (codes on a phone, +0D -1D +0Wk -1Wk +0M -1M CSTM ALL; words from desktop width up) and, under
 * them, what the chosen one covers in words, as of the current Manila time when it runs to today.
 */
export function PeriodPresetsBar({
  state,
  onChange,
  today,
  allowAll = false,
  years = false,
  className,
}: {
  state: PresetState;
  onChange: (next: PresetState) => void;
  today: string;
  allowAll?: boolean;
  /** Also offer This year and Last year. */
  years?: boolean;
  className?: string;
}) {
  const now = useNow();
  const custom = state.key === "custom" ? presetWindow(state, today) : null;
  const pick = (key: PresetKey) => {
    if (key !== "custom") return onChange({ key });
    // A custom range starts from what is showing now (or this month).
    const from = presetWindow(state, today) ?? presetWindow({ key: "this_month" }, today)!;
    onChange({ key: "custom", from: from.from, to: from.to });
  };
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 print:hidden", className)}>
      {/* On a phone the chips share the width equally (one line, the chosen one always in sight); words from desktop up. */}
      <div className="flex gap-1 lg:flex-wrap lg:gap-1.5" role="group" aria-label="Period">
        {PRESETS.filter((p) => (p.key !== "all" || allowAll) && (years || (p.key !== "this_year" && p.key !== "last_year"))).map((p) => (
          <button
            key={p.key}
            type="button"
            title={p.label}
            aria-label={p.label}
            aria-pressed={state.key === p.key}
            onClick={() => pick(p.key)}
            className="min-w-0 flex-1 rounded-full border border-border px-1 py-1 text-center text-theme-xs font-medium whitespace-nowrap text-muted-foreground tabular-nums lg:flex-none lg:px-3 transition-colors hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
          >
            <span className="lg:hidden">{p.code}</span>
            <span className="hidden lg:inline">{p.label}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {custom ? (
          <span className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              aria-label="From"
              className="h-8 w-40"
              value={custom.from}
              max={custom.to}
              onChange={(e) => e.target.value && onChange({ key: "custom", from: e.target.value, to: custom.to })}
            />
            <span className="text-theme-xs text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To"
              className="h-8 w-40"
              value={custom.to}
              min={custom.from}
              onChange={(e) => e.target.value && onChange({ key: "custom", from: custom.from, to: e.target.value })}
            />
          </span>
        ) : null}
        <span className="text-theme-xs text-muted-foreground" aria-live="polite">
          {(() => {
            const text = presetDescription(state, today, now);
            const at = text.indexOf(": ");
            return (
              <>
                <b className="font-semibold text-foreground">{text.slice(0, at)}:</b>
                {text.slice(at + 1)}
              </>
            );
          })()}
        </span>
      </div>
    </div>
  );
}
