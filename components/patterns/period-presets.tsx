"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { todayIso } from "@/lib/utils/date";
import { PRESETS, parsePreset, presetLabel, presetQuery, presetWindow, type PresetKey, type PresetState } from "@/lib/utils/period-presets";

const storageKey = (page: string) => `laf-period:${page}`;

/**
 * A page's period (Nov 2026), kept in the address (`?period=this_week`, custom adds `from`/`to`) so a link or a
 * reload shows the same figures. With no period in the address, the one last picked on this page on this device
 * comes back; otherwise the page's default. The page must sit inside a React.Suspense (useSearchParams).
 */
export function usePeriodPresets(page: string, fallback: PresetKey, allowAll = false) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const today = todayIso();
  const state = React.useMemo(() => parsePreset((k) => params.get(k), fallback, allowAll), [params, fallback, allowAll]);
  const window = React.useMemo(() => presetWindow(state, today), [state, today]);

  const write = React.useCallback(
    (next: PresetState, remember: boolean) => {
      const q = new URLSearchParams(params.toString());
      for (const k of ["period", "from", "to"]) q.delete(k);
      for (const [k, v] of Object.entries(presetQuery(next))) q.set(k, v);
      if (remember) {
        try {
          window_localStorage()?.setItem(storageKey(page), JSON.stringify(next));
        } catch {
          // Storage blocked (private window): the address still carries the choice.
        }
      }
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [params, pathname, router, page]
  );

  // Once: the period last picked here, when the address doesn't name one.
  const restored = React.useRef(false);
  React.useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (params.get("period")) return;
    try {
      const saved = JSON.parse(window_localStorage()?.getItem(storageKey(page)) ?? "null") as PresetState | null;
      if (saved && PRESETS.some((p) => p.key === saved.key) && (saved.key !== "all" || allowAll) && saved.key !== fallback) write(saved, false);
    } catch {
      // Nothing usable stored: the default stands.
    }
  }, [params, page, fallback, allowAll, write]);

  return { state, window, label: presetLabel(state, window), setState: (next: PresetState) => write(next, true), today };
}

const window_localStorage = () => (typeof window === "undefined" ? null : window.localStorage);

/** Today · Yesterday · This week · Last week · This month · Last month · Custom (· All time), and what the figures cover. */
export function PeriodPresetsBar({
  state,
  onChange,
  label,
  today,
  allowAll = false,
  className,
}: {
  state: PresetState;
  onChange: (next: PresetState) => void;
  label: string;
  today: string;
  allowAll?: boolean;
  className?: string;
}) {
  const custom = state.key === "custom" ? presetWindow(state, today) : null;
  const pick = (key: PresetKey) => {
    if (key !== "custom") return onChange({ key });
    // A custom range starts from what is showing now (or this month).
    const from = presetWindow(state, today) ?? presetWindow({ key: "this_month" }, today)!;
    onChange({ key: "custom", from: from.from, to: from.to });
  };
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 print:hidden", className)}>
      {/* Wraps instead of scrolling, so the chosen period is always in sight on a phone. */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period">
        {PRESETS.filter((p) => p.key !== "all" || allowAll).map((p) => (
          <button
            key={p.key}
            type="button"
            title={p.code}
            aria-pressed={state.key === p.key}
            onClick={() => pick(p.key)}
            className="shrink-0 rounded-full border border-border px-3 py-1 text-theme-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
          >
            {p.label}
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
        <span className="text-theme-xs text-muted-foreground">Figures cover: {label}</span>
      </div>
    </div>
  );
}
