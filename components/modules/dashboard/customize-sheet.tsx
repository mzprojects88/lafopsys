"use client";

import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { saveMyDashboard } from "@/lib/hooks/use-dashboard";
import { ACTIONS, CARDS, MAX_ACTIONS, move, type ActionKey, type CardKey } from "@/lib/utils/dashboard-catalog";
import { PRESETS } from "@/lib/utils/period-presets";

const PERIODS = PRESETS.filter((p) => !["custom", "all"].includes(p.key));

/** One list to pick from: the chosen ones in their order (with up and down), then the rest to switch on. */
function Picker<K extends string>({ title, options, chosen, onChange, max }: { title: string; options: { key: K; label: string }[]; chosen: K[]; onChange: (next: K[]) => void; max?: number }) {
  const label = (k: K) => options.find((o) => o.key === k)?.label ?? k;
  const rest = options.filter((o) => !chosen.includes(o.key));
  const full = max !== undefined && chosen.length >= max;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-theme-sm font-semibold">{title}{max ? <span className="font-normal text-muted-foreground"> · up to {max}</span> : null}</h3>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {chosen.map((k, i) => (
          <li key={k} className="flex items-center gap-2 px-3 py-1.5 text-theme-sm">
            <Checkbox checked onCheckedChange={() => onChange(chosen.filter((x) => x !== k))} aria-label={`Hide ${label(k)}`} />
            <span className="min-w-0 flex-1 truncate">{label(k)}</span>
            <Button variant="ghost" size="icon-sm" disabled={i === 0} aria-label={`Move ${label(k)} up`} onClick={() => onChange(move(chosen, k, -1))}><ArrowUp /></Button>
            <Button variant="ghost" size="icon-sm" disabled={i === chosen.length - 1} aria-label={`Move ${label(k)} down`} onClick={() => onChange(move(chosen, k, 1))}><ArrowDown /></Button>
          </li>
        ))}
        {rest.map((o) => (
          <li key={o.key} className="flex items-center gap-2 px-3 py-1.5 text-theme-sm text-muted-foreground">
            <Checkbox checked={false} disabled={full} onCheckedChange={() => onChange([...chosen, o.key])} aria-label={`Show ${o.label}`} />
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Customize (0147): the person's cards and quick actions, in their order, and the period the dashboard opens on.
 * Only what their profile offers is listed; saved to their account, so it follows them to any device.
 */
export function CustomizeSheet({
  open,
  onOpenChange,
  allowed,
  usable,
  current,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  allowed: ReadonlySet<string>;
  usable: ActionKey[];
  current: { cards: CardKey[]; actions: ActionKey[]; period: string };
}) {
  const [cards, setCards] = React.useState(current.cards);
  const [actions, setActions] = React.useState(current.actions);
  const [period, setPeriod] = React.useState(current.period);
  const [busy, setBusy] = React.useState(false);

  async function save(reset = false) {
    setBusy(true);
    const error = await saveMyDashboard(reset ? null : { cards, actions, period });
    setBusy(false);
    if (error) return void toast.error(error);
    toast.success(reset ? "Back to the default dashboard" : "Your dashboard is saved");
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Customize your dashboard</SheetTitle>
          <SheetDescription>Pick the cards and shortcuts you want, in your order, and the period it opens on. Only for you.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-theme-sm font-semibold">Opens on</h3>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p.key} value={p.key}>{p.key === "this_year" ? "Year to date" : p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </section>
          <Picker title="Cards" options={CARDS.filter((c) => allowed.has(c.key)).map((c) => ({ key: c.key, label: c.title }))} chosen={cards} onChange={setCards} />
          <Picker title="Quick actions" options={ACTIONS.filter((a) => usable.includes(a.key)).map((a) => ({ key: a.key, label: a.label }))} chosen={actions} onChange={setActions} max={MAX_ACTIONS} />
        </div>
        <SheetFooter className="flex-row flex-wrap justify-between border-t border-border">
          <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>Reset to default</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
