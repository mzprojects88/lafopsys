"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALL, passes, type FilterOption } from "@/lib/utils/filters";

/**
 * A page's dropdown filters (Nov 2026), each starting at All: `values[key]`, `set(key)` for a dropdown,
 * `ok(key, value)` to test a row, `active` (how many are set) and `clear()` for the Clear filters button.
 */
export function useFilters<K extends string>(...keys: K[]) {
  const blank = Object.fromEntries(keys.map((k) => [k, ALL])) as Record<K, string>;
  const [values, setValues] = React.useState(blank);
  return {
    values,
    set: (key: K) => (value: string) => setValues((v) => ({ ...v, [key]: value })),
    ok: (key: K, value: string | null | undefined) => passes(values[key], value),
    active: keys.filter((k) => values[k] !== ALL).length,
    clear: () => setValues(blank),
  };
}

/** One dropdown: "All <things>" first, then the options. An option list of one or none hides the dropdown. */
export function FilterSelect({ all, value, onChange, options, className = "w-40" }: { all: string; value: string; onChange: (v: string) => void; options: FilterOption[]; className?: string }) {
  if (options.length < 2 && value === ALL) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} aria-label={`Filter: ${all}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Clear filters", shown only while a filter is set. */
export function ClearFilters({ active, onClear }: { active: number; onClear: () => void }) {
  if (!active) return null;
  return (
    <Button type="button" size="sm" variant="ghost" onClick={onClear}>
      <X />
      Clear filters ({active})
    </Button>
  );
}
