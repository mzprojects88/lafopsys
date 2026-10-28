"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { MenuMeal } from "@/lib/utils/menu-week-ui";
import type { MealInput } from "@/lib/hooks/use-menu-week";

export interface StockItem {
  id: string;
  name: string;
  uom: string;
  onHand: number;
}

/**
 * One meal of the week (0068): the dish, its ingredients with a quantity per serving (from the
 * food on hand), the servings, a note, and alternative plates for people under a doctor's food
 * instruction. The same dialog shape lives in LAF Inventory.
 */
export function MealEditorDialog({
  open,
  date,
  mealType,
  mealLabel,
  meal,
  stock,
  dishes,
  people,
  defaultServings,
  onSave,
  onOpenChange,
}: {
  open: boolean;
  date: string;
  mealType: string;
  mealLabel: string;
  meal: MenuMeal | null;
  stock: StockItem[];
  /** Known dishes, for the name's suggestions. */
  dishes: { id: string; name: string; ingredients: { itemId: string; perServing?: number }[] }[];
  /** "Person N" -> who, for those who see clinical detail; the labels alone otherwise. */
  people: Record<string, { name: string; instruction: string }>;
  labels: string[];
  defaultServings: number;
  onSave: (meal: MealInput) => Promise<{ ok: true } | { ok: false; error: string }>;
  onOpenChange: (open: boolean) => void;
} & { labels: string[] }) {
  // Mounted fresh per meal (the parent keys it), so the state starts from the meal.
  const [dish, setDish] = React.useState(meal?.dish ?? "");
  const [recipeId, setRecipeId] = React.useState<string | null>(meal?.recipeId ?? null);
  const [servings, setServings] = React.useState(String(meal?.servings ?? defaultServings));
  const [notes, setNotes] = React.useState(meal?.notes ?? "");
  const [ingredients, setIngredients] = React.useState<{ itemId: string; perServing: string }[]>((meal?.ingredients ?? []).map((i) => ({ itemId: i.itemId, perServing: i.perServing === undefined ? "" : String(i.perServing) })));
  const [alternatives, setAlternatives] = React.useState<{ label: string; dish: string; note: string }[]>((meal?.alternatives ?? []).map((a) => ({ label: a.label, dish: a.dish, note: a.note })));
  const [query, setQuery] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const stockById = React.useMemo(() => new Map(stock.map((s) => [s.id, s])), [stock]);
  const matches = query.trim() ? stock.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()) && !ingredients.some((i) => i.itemId === s.id)).slice(0, 8) : [];
  const dishMatches = dish.trim().length >= 2 && !recipeId ? dishes.filter((d) => d.name.toLowerCase().includes(dish.toLowerCase())).slice(0, 5) : [];

  function pickDish(d: (typeof dishes)[number]) {
    setDish(d.name);
    setRecipeId(d.id);
    if (!ingredients.length) setIngredients(d.ingredients.filter((i) => stockById.has(i.itemId)).map((i) => ({ itemId: i.itemId, perServing: i.perServing === undefined ? "" : String(i.perServing) })));
  }

  async function save() {
    const n = Number(servings);
    if (!dish.trim()) return void toast.error("Name the dish.");
    if (!Number.isInteger(n) || n < 1 || n > 200) return void toast.error("Servings: a whole number from 1 to 200.");
    const ing = ingredients.map((i) => ({ itemId: i.itemId, perServing: i.perServing.trim() === "" ? undefined : Number(i.perServing) }));
    if (ing.some((i) => i.perServing !== undefined && (!Number.isFinite(i.perServing) || i.perServing <= 0 || i.perServing > 5))) return void toast.error("Per serving: more than 0 and at most 5 of the item's unit.");
    const alts = alternatives.filter((a) => a.dish.trim()).map((a) => ({ label: a.label, instruction: people[a.label]?.instruction ?? "", dish: a.dish.trim(), note: a.note.trim() }));
    setSaving(true);
    const r = await onSave({ date, meal_type: mealType, dish: dish.trim(), recipe_id: recipeId, ingredients: ing, servings: n, notes: notes.trim(), alternatives: alts });
    setSaving(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${mealLabel} saved`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mealLabel} · {date}
          </DialogTitle>
          <DialogDescription>{meal?.status === "approved" ? "Changing an approved meal sends it back for review." : "What the kitchen will cook, and what it takes from stock."}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
          <Field>
            <FieldLabel htmlFor="meal-dish">Dish</FieldLabel>
            <Input id="meal-dish" value={dish} maxLength={120} onChange={(e) => { setDish(e.target.value); setRecipeId(null); }} placeholder="e.g. Chicken tinola with rice" />
            {dishMatches.length ? (
              <div className="flex flex-wrap gap-1 pt-1">
                {dishMatches.map((d) => (
                  <Button key={d.id} type="button" size="sm" variant="outline" className="h-7" onClick={() => pickDish(d)}>
                    {d.name}
                  </Button>
                ))}
              </div>
            ) : null}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="meal-servings">Servings</FieldLabel>
              <Input id="meal-servings" type="number" inputMode="numeric" min={1} max={200} value={servings} onChange={(e) => setServings(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="meal-notes">Note</FieldLabel>
              <Input id="meal-notes" value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
            </Field>
          </div>

          <Field>
            <FieldLabel>Ingredients from stock (per serving)</FieldLabel>
            <div className="flex flex-col gap-1.5">
              {ingredients.map((i, idx) => {
                const s = stockById.get(i.itemId);
                return (
                  <div key={i.itemId} className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{s?.name ?? "Item no longer in stock"}</span>
                    <Input aria-label={`Per serving of ${s?.name ?? "item"}`} type="number" inputMode="decimal" min={0} step={0.01} className="h-8 w-24 text-right" value={i.perServing} placeholder="qty" onChange={(e) => setIngredients((prev) => prev.map((p, j) => (j === idx ? { ...p, perServing: e.target.value } : p)))} />
                    <span className="w-10 text-theme-xs text-muted-foreground">{s?.uom ?? ""}</span>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove ingredient" onClick={() => setIngredients((prev) => prev.filter((_, j) => j !== idx))}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
              <Command shouldFilter={false} className="rounded-xl border border-border">
                <CommandInput placeholder="Add an ingredient from stock…" value={query} onValueChange={setQuery} />
                {query.trim() ? (
                  <CommandList>
                    <CommandEmpty>Nothing in stock by that name.</CommandEmpty>
                    <CommandGroup>
                      {matches.map((s) => (
                        <CommandItem key={s.id} value={s.id} onSelect={() => { setIngredients((prev) => [...prev, { itemId: s.id, perServing: "" }]); setQuery(""); }}>
                          <span className="flex-1">{s.name}</span>
                          <span className="text-theme-xs text-muted-foreground">{s.onHand} {s.uom} on hand</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                ) : null}
              </Command>
            </div>
          </Field>

          {Object.keys(people).length || alternatives.length ? (
            <Field>
              <FieldLabel>Alternative plates (doctor&apos;s food instructions)</FieldLabel>
              <div className="flex flex-col gap-1.5">
                {alternatives.map((a, idx) => (
                  <div key={`${a.label}-${idx}`} className="flex flex-col gap-1 rounded-xl border border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-theme-xs text-muted-foreground">
                      <span>
                        {people[a.label]?.name ?? a.label}
                        {people[a.label]?.instruction ? ` · ${people[a.label]!.instruction}` : ""}
                      </span>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove alternative" onClick={() => setAlternatives((prev) => prev.filter((_, j) => j !== idx))}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input aria-label="Alternative dish" value={a.dish} maxLength={120} placeholder="Dish for them" onChange={(e) => setAlternatives((prev) => prev.map((p, j) => (j === idx ? { ...p, dish: e.target.value } : p)))} />
                      <Input aria-label="Alternative note" value={a.note} maxLength={200} placeholder="note" onChange={(e) => setAlternatives((prev) => prev.map((p, j) => (j === idx ? { ...p, note: e.target.value } : p)))} />
                    </div>
                  </div>
                ))}
                {Object.keys(people)
                  .filter((l) => !alternatives.some((a) => a.label === l))
                  .map((l) => (
                    <Button key={l} type="button" size="sm" variant="outline" className="h-7 w-fit gap-1" onClick={() => setAlternatives((prev) => [...prev, { label: l, dish: "", note: "" }])}>
                      <Plus className="size-3.5" /> Plate for {people[l]?.name ?? l}
                    </Button>
                  ))}
              </div>
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save meal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
